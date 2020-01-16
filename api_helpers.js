// For help: https://github.com/AutotaskDevelopment/Sample-Code/blob/master/Connection Examples/NodeJs Example.js
// API Docs: https://github.com/opendns/autotask-php/files/2789940/T_WebServicesAPIv1_6.pdf

/*
 * This script is called by api_relay_server.js. api_relay_server.js is the main node server.
 * This script just contains the code needed to generate and interpret API requests/responses.
 * 
 * API Notes:
 * An employee is considered a "Resource" in the API (pg. 236)
 * A school is considered an "Account" in the API (pg. 39)
 * An expense report is filed as an "ExpenseItem" in the API. An "ExpenseItem" is part of an "ExpenseReport" (pg. 140/145)
 * Travel project times are submitted as a ("Project"???) (pg. 205)
 * A "TimeEntry" is used for general or regular time (pg. 325)
*/

const https = require("https")
var config = require("./config.js")
var xml2js = require("xml2js").parseString

var EXPENSE_TITLE = "Gas Expenses" // name of the expense report. The month will be added (e.g EXPENSE_TITLE="Gas" will create the report: "Gas for August 2019")
var TRAVEL_DESCRIPTION = "Travel from" // Same as above

const STATUS_GOOD = 0
const STATUS_WARN = 1
const STATUS_ERR  = 2
const STATUS_MAP = ["Success", "Warning", "Error"]

// These variables are essentially caches. As long as the server is up, these values will remain populated
var emailToAuthTokenMap = {}
var emailToResourceIDMap = {}
var contractIDToAccountIDMap = {}
var travelDistanceMap = {}
var addressToAccountIDMap = {}
var accountIDToAnnualProjectMap = {}
var annualProjectIDToTaskIDMap = {}
var cachedTimeEntryHashes = {}
var cachedExpenseItemHashes = {}

// For the Google Distance Matrix API
var imperialOrMetric = "imperial"

// The client can request that we overwrite cached values. Set by POST params
var ignoreCache = false

// Global variables for the API's bulky SOAP requirements
var requestHeader = '<?xml version="1.0" encoding="utf-8"?>' +
"<soap:Envelope " +
'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ' +
'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
'xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
"<soap:Header>" +
'<AutotaskIntegrations xmlns="http://autotask.net/ATWS/v1_6/">' + // To use version 1.6 change to http://autotask.net/ATWS/v1_6/
"<PartnerID>" +
"</PartnerID>" +
"<IntegrationCode>" +
config.TRACKING_IDENTIFIER +
"</IntegrationCode>" +
"</AutotaskIntegrations>" +
"</soap:Header>" +
"<soap:Body>"
var requestTail = "</soap:Body>" +
"</soap:Envelope>";






/*  ***  HELPER FUNCTIONS  ***  */

// Cleaning up inputs to deny string injection attacks
function clean(val, justQuotes = false)
{
	if (val == undefined)
		return val

	if (justQuotes)
		return val.replace(/["']/g, "");

	return val.replace(/[|&;$%@"'<>()+,]/g, "");
}

// For easier reading and writing, as well as a consistent format
function log(tag, msg)
{
	console.log(tag + ": " + msg)
}

// Shorter is sweeter
function j(str)
{
	return JSON.stringify(str, null, 4)
}

// Convert a date of any format that javascript Date() object can parse and return it in a Autotask-API-friendly manner
function formatDate(dateValue)
{
	var dt = new Date(dateValue)
	var currentYear = dt.getFullYear()
	var current_date = dt.getDate()
	var current_month = dt.getMonth() + 1
	var current_year = dt.getFullYear()
	var current_hrs = dt.getHours()
	var current_mins = dt.getMinutes()
	var current_secs = dt.getSeconds()

	// Add 0 before date, month, hrs, mins or secs if they are less than 0
	current_date = current_date < 10 ? '0' + current_date : current_date
	current_month = current_month < 10 ? '0' + current_month : current_month
	current_hrs = current_hrs < 10 ? '0' + current_hrs : current_hrs
	current_mins = current_mins < 10 ? '0' + current_mins : current_mins
	current_secs = current_secs < 10 ? '0' + current_secs : current_secs
	
	return currentYear + '-' + current_month + '-' + current_date + 'T' + current_hrs + ':' + current_mins + ':' + current_secs
}

// Gives each car trip entry a unique fingerprint. Useful for caching and removing the edge case where 2 field techs make the same trip together
function hashTrip(trip)
{
	var orderedValues = []

	// Take the values of trip and insert them in a certain order into an array. Stringify that ordered array and call it a hash
	orderedValues.push(trip.leaveTime)
	orderedValues.push(trip.arriveTime)
	orderedValues.push(trip.fromAccountID)
	orderedValues.push(trip.toAccountID)
	orderedValues.push(trip.resourceID)

	return JSON.stringify(orderedValues)
}

//Sorts tickets by EndDateTime (day then time)
function sortTickets(tickets)
{
	tickets.sort(function(a, b) {
	    	return (new Date(a.EndDateTime) - new Date(b.EndDateTime));
	});

	return tickets
}

// At some point we will have the full address data for each school involved with tickets.
// This function is used to convert those full addresses into a format that will be compatible with the Google Distance Matrix API
function getAccountAddress(accountData)
{
	return accountData.Address1 + " " + accountData.City + ", " + accountData.State + " " + accountData.PostalCode
}

// Given a time entry start time and end time, find the time between and round up
function roundToNearest15(startTime, endTime, inc = 4) // Round the hour into "inc" (increments) chunks. inc = 2 rounds to the half hour. 4 rounds to the nearest 15 mins
{
	var hours = ((new Date(endTime) - new Date(startTime)) / 1000) / 3600

	var roundedHours = Math.round(hours * inc) / inc     // round to every quarter hour

	return roundedHours
}






/*  ***  SOAP API FUNCTION  ***  */


// Accepts SOAP XML as the input
// wraps the XML with the global SOAP headers and sends the request
// Optional action tag can be used to generalize the function, "query" and "create" or most commonly used
// Optional log parameter added for easier debugging
function sendRequest(soapXML, resourceID, callback, action = "query", log = false)
{
	soapXML = requestHeader + soapXML + requestTail

	// Set the unique soap options. Add authentication parameters
	// webservices[3] = East coast
	SOAP_OPTIONS = {
		host: "webservices3.autotask.net",
		port: 443,
		method: "POST",
		path: "/atservices/1.6/atws.asmx",
		// authentication headers
		headers: {
		    'Content-Type': "text/xml; charset=utf-8",
		    'Content-Length': Buffer.byteLength(soapXML),
		    'Authorization': "Basic " + new Buffer(config.API_USERNAME + ":" + config.API_PASSWORD).toString("base64"),
		    'SOAPAction': "http://autotask.net/ATWS/v1_6/" + action,
		    'Accept': "application/json"
		}
	}

	responseData = ""

	request = https.request(SOAP_OPTIONS, function (res) {
		//console.log("statusCode:", res.statusCode);
		//console.log('headers:', res.headers);
	
		// Large responses come in chunks
		res.on("data", (d) => {
			if (log)
				console.log("Send: " + d.toString());
			responseData += d.toString()
		});

		res.on("end", () => {
			console.log(action + " recieved")

			// A specific (usually) non-client related error that an administrator will need to intervene to fix
			// This is essentially just crash padding. May happen if the API account gets locked
			if (responseData.indexOf("SoapException") >= 0)
			{
				addReturnLog(STATUS_ERR, "An API request error has occured. Please contact your System Administrator to resolve this", resourceID)

				// Make sure to log the raw response data for easier debugging
				console.log(responseData)
			}

			callback(responseData)
		});
	});

	request.on("error", (e) => {
	    console.error("error sending request: " + e);
	});

	request.end(soapXML.toString())	
}

// Parses the bulky response SOAPXML from the API server, leaving just the relevant information remaining
function getEntities(xmlObject)
{
	try
	{
		return xmlObject["soap:Envelope"]["soap:Body"][0].queryResponse[0].queryResult[0].EntityResults[0].Entity
	}
	catch (e) { return undefined }
}

// Same function as the above except slightly different responses come from create requests (rather than queries)
function getCreateEntities(xmlObject)
{
	try
	{
		return xmlObject["soap:Envelope"]["soap:Body"][0].createResponse[0].createResult[0].EntityResults[0].Entity
	}
	catch (e) { return undefined }
}






/*  ***  REQUEST MAKING FUNCTIONS  ***  */

/*
 * This function should be used for any future add-ons to this script, inplace of the non-generic functions seen below
 *
 * All request functions like these follow the same format as this function, so I will only add comments to unique lines of code
 *
 * Entity is a string value
 * fields is an array of strings, represents the field values that you want to query
 * expressions is an array of objects. Each index corresponds with a field, and looks like [{"op": opValue, "val": value}]
 * callback is essentially the return value. Since sending the API request has to be asynchronous, everything must use callbacks
 */
function buildGenericQuery(resourceID, entity, fields, expressions, callback)
{
	// Basic error checking
	if (fields.length != expressions.length)
	{
		console.log("Invalid params")
		callback(undefined)
		return
	}

	// The query header and tail
	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>" + entity + "</entity><query>"
	var queryStringTail = "</query></queryxml>]]></sXML></query>"

	var queryBody = ""

	// Auto-generate the soap XML, filling in the values with the array values
	for (var i = 0; i < fields.length; i++)
	{
		queryBody += "<field>" + fields[i]

		for (var j = 0; j < expressions[i].length; j++)
		{
			queryBody += "<expression op='" + expressions[i][j]["op"] + "'>" + expressions[i][j]["val"] + "</expression>"
		}

		queryBody += "</field>"
	}

	// Send the query request to the API server, parse the XML response with xml2js and strip the unecessary data, return that in the callback
	// A callback of undefined essentially means "error", so log the relevant error message before the callback
	// The data passed back to the callback should be a more generic object. Specific parsing should be implemented in the passed in callback
	sendRequest(queryStringHead + queryBody + queryStringTail, resourceID, function(apiResponse) {
		// Convert Soap XML to a JS object
		xml2js(apiResponse, function(err, result) {
			// The API returns an array of Entities (API Entities). This could be anything from Accounts, Tickets, ExpenseReports, etc.
			var entities = getEntities(result)

			// Basic error checking
			if (entities && entities.length > 0)
			{
				callback(entities)
			}
			else
			{
				addReturnLog(STATUS_ERR, "No entities were found in generic request for: " + entity + "s")
				callback(undefined)
			}
		})
	})
}

// Returns the ResourceID associated with the email of the field tech making the request
function buildResourceQueryRequest(resourceEmail, callback)
{
	if (emailToResourceIDMap[resourceEmail] != undefined)
		callback(emailToResourceIDMap[resourceEmail])

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>Resource</entity><query><field>Email"
	var queryBody = "<expression op='equals'>" + resourceEmail + "</expression>"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"

	sendRequest(queryStringHead + queryBody + queryStringTail, null, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var resources = getEntities(result)
			if (resources == undefined || resources.length == 0)
			{
				// Additional error logging. If the script fails here, there is likely some other API issue going on
				log("Resources", resources)
				log("Query", queryBody)
				addReturnLog(STATUS_ERR, "No resources found that match the email: " + resourceEmail)
				callback(undefined)
			}
			else
			{
				callback(resources[0].id[0])
			}
		})
	})
}

// Returns a list of the resourceID's (field tech's) previous tickets
// If we are trying to automate expenseReport generation, we grab tickets from the past month
// If we are trying to automate travel time entries, we grab tickets from the past week
function buildTicketsQueryRequest(resourceID, generatingTravelTimes, callback)
{
	var lastMonday = new Date()
	lastMonday.setHours(1)
	lastMonday.setMinutes(0)

	if (generatingTravelTimes)
	{
		lastMonday.setDate(lastMonday.getDate() - ((lastMonday.getDay() + 6) % 7)) // Sets date to last Monday. Don't ask me for a mathematical proof
	}
	else
	{
		lastMonday.setDate(1)                               // Set the date to the first of the month
		if (lastMonday.getDay() > 1)
			lastMonday.setDate(1 - lastMonday.getDay()) // If the first day is not a monday, rewind the date to the previous monday
	}

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>TimeEntry</entity><query><field>StartDateTime"
	var queryBody = "<expression op='greaterthan'>" + formatDate(lastMonday) + "</expression>"
	queryBody += "</field><field>ResourceID<expression op='equals'>" + resourceID + "</expression>"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"

	sendRequest(queryStringHead + queryBody + queryStringTail, resourceID, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var tickets = getEntities(result)

			if (tickets && tickets.length > 0)
			{
				callback(tickets)
			}
			else
			{
				addReturnLog(STATUS_ERR, "No tickets were found for resource: " + resourceID, resourceID)
				callback(undefined)
			}
		})
	})
}

// This function takes a list of ContractIDs. These ContractIDs come from the resource's tickets (from the function above).
// Each ticket has an associated contractID. The purpose of this function is to convert those contractIDs into AccountIDs so that we can collect account information
// Note: Since this function makes all calls asynchronously, the account IDs may come back out of order. Use the map to ensure you have the correct account when referencing
function buildContractIDsQueryRequest(contractIDs, resourceID, callback)
{
	var accountIDs = []

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>Contract</entity><query><field>id"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"
	var queries = ""
	for (var i = 0; i < contractIDs.length; i++)
	{
		var contractID = contractIDs[i]

		if (contractIDToAccountIDMap[contractID] != undefined) // Check to see if we have already seen this contractID
		{
			accountIDs.push(contractIDToAccountIDMap[contractID])
			continue
		}

		queries += "<expression op='equals'>" + contractIDs[i] + "</expression>"
	}

	sendRequest(queryStringHead + queries + queryStringTail, resourceID, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			//console.log("---" + JSON.stringify(result))
			var contracts = getEntities(result)

			if (contracts != undefined && contracts.length > 0) // Will come back empty if all trips are cached
			{
				for (var i = 0; i < contracts.length; i++)
				{
					accountID = contracts[i].AccountID[0]._

					// Update the cache
					contractIDToAccountIDMap[contracts[i].id[0]] = accountID

					accountIDs.push(accountID)
				}

				callback(accountIDs)
			}
			else
			{
				// Cached values will already have been added to the accountIDs array
				if (accountIDs.length > 0)
				{
					callback(accountIDs)
				}
				else
				{
					log("Query", queries)
					log("Error", j(result))
					addReturnLog(STATUS_ERR, "No accounts returned from list of contracts: " + j(contractIDs), resourceID)
					callback(undefined)
				}
			}
		})
	})
}

// This function takes the accountIDs output from the above function, and collects relevant account information
// This information includes account Address and name (as well as other data, but nothing else that is used by this script currently)
function buildAccountIDsQueryRequest(accountIDs, resourceID, callback)
{
	// Store every account as a hashmap where the key is the account ID and the data is the name and address
	var accountsData = {}

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>Account</entity><query><field>id"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"
	var queries = ""
	for (var i = 0; i < accountIDs.length; i++)
	{
		queries += "<expression op='equals'>" + accountIDs[i] + "</expression>"
	}

	sendRequest(queryStringHead + queries + queryStringTail, resourceID, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var accounts = getEntities(result)

			if (accounts == undefined || accounts.length == 0)
			{
				log("Error", JSON.stringify(result))
				addReturnLog(STATUS_ERR, "No accounts found with IDs: " + j(accountIDs), resourceID)
				callback(undefined)
				return
			}

			for (var i = 0; i < accounts.length; i++)
			{
				var accountData = {}
			
				accountData.Address1 = accounts[i].Address1[0]._
				accountData.AccountName = accounts[i].AccountName[0]._
				accountData.PostalCode = accounts[i].PostalCode[0]._
				accountData.City = accounts[i].City[0]._
				accountData.State = accounts[i].State[0]._
				//accountsData[id] = accounts[i].id[0]._

				// Update the cache
				addressToAccountIDMap[getAccountAddress(accountData)] = accounts[i].id[0]
				accountsData[accounts[i].id[0]] = accountData
			}

			callback(accountsData)
		})
	})

}

/*
 * This function is the heart of this automation script
 * It looks at a bunch of ticket time entries in order to understand which schools you have been to
 * It then uses the ticket end time from one school, and the ticket start time of the next school, to determine your approximate driving time between the two
 * This way, your driving time is essentially logged as the "deadzone" time between time entries
 * This is also the location where we cache the majority of our data, and create the travelData object
 * The travelData object is passed to every successive function, and represents the totality of the travel data for the given time period
 * 	The values stored in each trip can be seen about 30 lines below. Also added later will be travel distance using the Google Distance Matrix API
 * The confusion is that the tickets data represent a time entry made within an organization, and that are tied to a single contract
 * 	This function converts that into a trip, which will contain the "limbo" data *between* two time entries
 */
function extrapolateTravelData(ticketsData, accountsData, homeAddress, resourceID, callback)
{
	var travelData = []  // An 2D array where each index has the travel data for a single day (travelData[0] is Monday's travel data, etc)
		 										 //travelData[0][0] is the first trip on Monday

	// Variables that keep track of the information for a given day
	// In the case where we log 2 or more tickets in a row at a specific location, we want to make sure we know that there was no travel time between those tickets
	// Only log travel time when two successive tickets are logged at different schools
	// All the information we need to verify these things is stored in the travelData object, which generated as we iterate over each time entries
	var lastToAddress = homeAddress
	var lastArriveTime = -1
	var lastTicketEndTime = -1
	var lastFromName = "Home"
	var lastAccountID = -1
	var currentDay = undefined

	if (ticketsData.length > 0) // Initialize the day. We want to seperate travel time by which day it occurred
	{
		currentDay = new Date(ticketsData[0].StartDateTime).getDate()
	}
	else
	{
		addReturnLog(STATUS_ERR, "No recent tickets have been found for you!")
		callback(undefined)
		return
	}

	//log("Map", j(contractIDToAccountIDMap)) // Currently cached data
	var travelForDay = []      // Stores the information for a single day of travelling
	var trip = {}

	// Iterate over every time entry (note: these are technically the TimeEntry Entity, as defined by the API, not tickets)
	for (var i = 0; i < ticketsData.length; i++)
	{
		var ticket = ticketsData[i]
		var trip = {}
		trip.resourceID = resourceID
		//log("Ticket", j(ticket))

		// The ticketsData only has the ContractID associated with it in the API, so grab that conversion from the cache
		// The trip object will have to contain the accountID from both the school it left from and is heading to
		var ticketAccountID = contractIDToAccountIDMap[ticket.ContractID]

		if (ticketAccountID == undefined) // If this happens, the error message may not be clearly reflecting the cause of the issue
		{				  // This value was just cached in the previous function so it should always be set
			console.log("Unknown ticket contract: " + ticket.ContractID)
			continue
		}

		var accountData = accountsData[ticketAccountID]

		var accountAddress = getAccountAddress(accountData)
		var accountName = accountData.AccountName

		if (accountAddress == lastToAddress)
		{
			lastTicketEndTime = ticket.EndDateTime
			continue   // We entered multiple tickets in a row here. No driving needs to be logged
		}

		var ticketDay = new Date(ticket.StartDateTime).getDate()

		// Log data for the new day
		if (ticketDay != currentDay)
		{
			//console.log("New day")

			// Now that we have seen time entries from two different schools, update the "to" and "from" fully in the trip object
			// Then add it to the trips array
			trip.fromAddress = lastToAddress
			trip.toAddress = homeAddress
			trip.leaveTime = lastTicketEndTime //new Date(ticket.EndDateTime) // convert to ms timestamp
			trip.arriveTime = -1
			trip.totalTimeHours = roundToNearest15(trip.leaveTime, trip.arriveTime)
			trip.fromName = lastFromName
			trip.toName = "Home"
			trip.fromAccountID = lastAccountID
			trip.toAccountID = -1
			travelForDay.push(trip)
			//log("Trip1", j(trip))
			//console.log("Tickets leaving: " + j(trip))

			
			// Update our tracking data to reflect the start of the new day and go to the next time entry
			lastArriveTime = -1
			lastToAddress = homeAddress
			lastTicketEndTime = -1
			lastAccountID = -1
			lastFromName = "Home"

			travelData.push(travelForDay)
			travelForDay = []

			currentDay = ticketDay

			i--
		
			continue
		}

		// Log data when we are arriving at a new school
		trip.fromAddress = lastToAddress
		trip.toAddress = accountAddress
		trip.leaveTime = lastTicketEndTime
		trip.arriveTime = ticket.StartDateTime
		trip.fromName = lastFromName
		trip.toName = accountName
		trip.totalTimeHours = roundToNearest15(trip.leaveTime, trip.arriveTime)
		trip.fromAccountID = lastAccountID
		trip.toAccountID = ticketAccountID
	
		// Update tracking data to reflect that we are at a new school
		lastToAddress = accountAddress
		lastTicketEndTime = ticket.EndDateTime
		lastAccountID = ticketAccountID
		lastFromName = accountName

		//log("Trip2", j(trip))

		travelForDay.push(trip)
	}

	// There will be no ticket to reflect time at home, so we have to manually add that trip, setting the toAddress to "Home" (along with other things)
	if (travelForDay.length > 0)
	{
		tripHome = {}
		tripHome.fromAddress = lastToAddress
		tripHome.toAddress = homeAddress
		tripHome.fromName = lastFromName
		tripHome.toName = "Home"
		tripHome.fromAccountID = lastAccountID
		tripHome.toAccountID = -1
		tripHome.leaveTime = lastTicketEndTime
		tripHome.arriveTime = -1
		tripHome.totalTimeHours = -1

		//log("Trip3", j(tripHome))
		travelForDay.push(tripHome) // Should this be here or outside of this if statement

		travelData.push(travelForDay)
	}

	//return
	callback(travelData)
}

function longestCommonSubstring(a, b)
{
	let len = b.length, originalLen = b.length;
	do
	{
		for ( let i = 0; i <= originalLen - len; i++ )
		{
			let needle = b.substr( i, len );
			if ( a.indexOf( needle ) !== -1 ) return needle;
		}
	} while ( len-- > 0 );

	return "";
}

// Given an address and an array of addresses, return the one with the longest matching substring
function findAddress(address, addresses)
{
	address = address.toLowerCase()
	address = address.replaceAll(",", "").replaceAll("street", "st").replaceAll("road", "rd").replaceAll("avenue", "ave")
	//console.log("Checking: " + address)
	var longestSubstringIndex = 0
	var longestSubstring = ""

	for (var i = 0; i < addresses.length; i++)
	{
		var a = addresses[i].toLowerCase()
		a = a.replaceAll(",", "").replaceAll("street", "st").replaceAll("road", "rd").replaceAll("avenue", "ave")

		//console.log("Comparing: " + a)

		var substring = longestCommonSubstring(a, address)

		//console.log("subString: " + substring)

		if (substring.length > longestSubstring.length)
		{
			longestSubstring = substring
			longestSubstringIndex = i
		}
	}

	//console.log("Returning: " + longestSubstringIndex + "\n\n\n")

	return [address, addresses[longestSubstringIndex]]
}

// Split this up into a function for expenses and travel times 
var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December" ]

// Still needs error reporting
function buildUploadDataRequest(travelData, requesterID, callback)
{
	if (travelData.length == 0 || travelData[0].length == 0)
	{
		addReturnLog(STATUS_ERR, "No travel data was found", requesterID)
		callback(undefined)
		return
	}

	var firstTrip = travelData[0][0]
	var lastTrip = travelData[travelData.length - 1][travelData.slice(-1)[0].length -1] // Javascript magic

	var endOfFirstWeek = new Date(firstTrip.arriveTime)
	endOfFirstWeek.setDate(endOfFirstWeek.getDate() + (6 - endOfFirstWeek.getDay()))
	endOfFirstWeek.setHours(23)

	// If the first week ends in the new month, the expense goes towards that month
	var expenseMonth = months[ endOfFirstWeek.getMonth() ]
	expenseYear = endOfFirstWeek.getFullYear()

	desiredName = EXPENSE_TITLE + " for " + expenseMonth + " " + expenseYear

	buildFindExpenseReportQuery(desiredName, requesterID, function(expenseReportID) {        // Technically this may cause issues for the edge case
		if (expenseReportID == -1)					         // Where the user creates expense reports for the entire year
		{								         // AND calls them by the exact same name as this program wants to call them
			buildCreateExpenseReportRequest(desiredName, endOfFirstWeek, requesterID, function(newExpenseReportID) {
				buildAddExpenseItemsRequest(travelData, newExpenseReportID, requesterID, function(apiResponse) {

					callback(apiResponse)

				})
			})
		}
		else
		{
			buildAddExpenseItemsRequest(travelData, expenseReportID, requesterID, function(apiResponse) {
				callback(apiResponse)
			})
		}
	})
}

function buildFindTravelProjectTaskQuery(projectIDs, resourceID, callback)
{
	var taskIDs = []

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>Task</entity><query>"//<field>ProjectID"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"
	
	var query = ""
	/*for (var i = 0; i < projectIDs.length; i++)
	{
		query += "<expression op='equals'>" + projectIDs[i] + "</expression>"
	}*/

	query += "<field>Title"
	query += "<expression op='equals'>" + "Travel Time" + "</expression>"

	sendRequest(queryStringHead + query + queryStringTail, resourceID, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var projects = getEntities(result)
			if (projects == undefined || projects.length == 0)
			{
				addReturnLog(STATUS_ERR, "No tasks found for annual projects with IDs: " + j(projectIDs), resourceID)
				callback(undefined)
			}
			else
			{
				for (var i = 0; i < projects.length; i++)
				{
					if (projectIDs.indexOf(projects[i].ProjectID[0]._) >= 0)
					{
						annualProjectIDToTaskIDMap[projects[i].ProjectID[0]._] = projects[i].id[0]
						taskIDs.push(projects[i].id[0])
					}
				}
				//console.log(j(result))
				callback(taskIDs)
			}
		})
	})

}

// TODO : For administrators. Travel times will stop working after August until the new (e.g 2020-2021 Annual Projects) projects are created
//
// For there seems to be some glitch in the API where having multiple expressions per field and multiple fields
// The result is that only the first expression is evaluated and the others are ignored
function buildFindTravelProjectQuery(accountIDs, resourceID, callback)
{
	var projectIDs = []
	var currentYear = new Date()
	var endYear = currentYear.getFullYear()
	if (currentYear.getMonth() >= 7) // Starting from August, the new project will be ending during the next school year
	{
		endYear++
	}
	else
	{
		currentYear.setMonth(-12)  // If it is not august yet, we need to search for projects that were created last year
	}
	currentYear.setMonth(0)
	currentYear.setDate(1)
	currentYear.setHours(1)

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>Project</entity><query>"//<field>AccountID"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"

	var query = ""
	/*var query = "<field>AccountID"
	for (var i = 0; i < accountIDs.length; i++)
	{
		query += "<expression op='equals'>" + accountIDs[i] + "</expression>"
	}
	query += "</field>"*/
	
	query += "<field>ProjectName"
	query += "<expression op='contains'>" + endYear + " Annual Project" + "</expression>"
	query += "</field><field>CreateDateTime"
	query += "<expression op='greaterthan'>" + formatDate(currentYear) + "</expression>"

	//console.log(queryStringHead + query + queryStringTail)
	sendRequest(queryStringHead + query + queryStringTail, resourceID, function(apiResponse) {
		//console.log(apiResponse)
		xml2js(apiResponse, function(err, result) {
			var projects = getEntities(result)
			if (projects == undefined || projects.length == 0)
			{
				log("Annual Project Query", query)
				log("Response", j(result))
				addReturnLog(STATUS_ERR, "No annual projects were found to be associated with any accounts", resourceID)
				callback(undefined)
			}
			else
			{
				for (var i = 0; i < projects.length; i++)
				{
					if (accountIDs.indexOf(projects[i].AccountID[0]._) >= 0)
					{
						//console.log(j(projects[i]))
						accountIDToAnnualProjectMap[projects[i].AccountID[0]._] = projects[i].id[0]
						projectIDs.push(projects[i].id[0])
					}
				}
				callback(projectIDs)
			}
		})
	})

}

function buildRolesQuery(resourceIDs, resourceID, callback)
{
	var reportID = -1

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>Role</entity><query><field>ID"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"
	
	var query = ""
	for (var i = 0; i < resourceIDs.length; i++)
	{
		query += "<expression op='equals'>" + resourceIDs[i] + "</expression>"
	}

	//console.log(queryStringHead + query + queryStringTail)
	sendRequest(queryStringHead + query + queryStringTail, resourceID, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var reports = getEntities(result)
			if (reports == undefined || reports.length == 0)
			{
				addReturnLog(STATUS_WARN, "No roles found for resources: " + j(resourceIDs) + " (this means these people likely aren't field technicians)", resourceID)
				callback(undefined)
			}
			else
			{
				callback(reports)
			}
		})
	})

}

function buildResourceRoleQuery(resourceID, callback)
{
	var reportID = -1

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>ResourceRole</entity><query><field>ResourceID"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"
	
	var query = "<expression op='equals'>" + resourceID + "</expression>"

	sendRequest(queryStringHead + query + queryStringTail, resourceID, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var reports = getEntities(result)
			if (reports == undefined || reports.length == 0)
			{
				addReturnLog(STATUS_ERR, "Unable to find a role associated with resource: " + resourceID + " (i.e 'field', 'grid')", resourceID)
				callback(undefined)
			}
			else
			{
				callback(reports)
			}
		})
	})

}

function buildFindExpenseReportQuery(desiredName, resourceID, callback)
{
	var reportID = -1

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>ExpenseReport</entity><query><field>name"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"

	var query = "<expression op='equals'>" + desiredName + "</expression>"

	sendRequest(queryStringHead + query + queryStringTail, resourceID, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var reports = getEntities(result)
			if (reports == undefined || reports.length == 0)
			{
				addReturnLog(STATUS_WARN, "No expense reports found found for this month (creating a new one)", resourceID)
				callback(-1)
			}
			else
			{
				reportID = reports[0].id[0]

				callback(reportID)
			}
		})
	})

}

function buildCreateExpenseReportRequest(desiredName, ticketDate, requesterID, callback)
{
	var monthEndDate = new Date(ticketDate)   // Set the expense report to end at the end of the month
	monthEndDate.setMonth(monthEndDate.getMonth() + 1) // Set the date to next month
	monthEndDate.setDate(0)      // This will wrap the date to the last day of the previous month
	monthEndDate.setHours(23)    // just before midnight
	monthEndDate.setMinutes(59)  // "
	monthEndDate.setSeconds(59)  // "

	//console.log("Week ending: " + ticketDate + " " + monthEndDate + " " + formatDate(monthEndDate))
	var queryStringHead = "<create xmlns='http://autotask.net/ATWS/v1_6/'><Entities>"
	var queryStringTail = "</Entities></create>"
	var query =     "<Entity xsi:type='ExpenseReport' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance'>" +
			"<Name>" + desiredName + "</Name>" +
			"<SubmitterID>" + requesterID + "</SubmitterID>" +
			"<WeekEnding>" + formatDate(monthEndDate) + "</WeekEnding>"  +
			"</Entity>"

	sendRequest(queryStringHead + query + queryStringTail, resourceID, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var expenseReports = getCreateEntities(result)

			if (expenseReports == undefined || expenseReports.length == 0)
			{
				addReturnLog(STATUS_ERR, "Failed to create new expense report.\nResponse:\n" + j(result), requesterID)
				callback(undefined)
			}
			else
			{
				addReturnLog(STATUS_GOOD, "Successfully created expense report", requesterID)
				callback(expenseReports[0].id[0])
			}
			//callback(result)
		})
	}, "create")
}

// Uses the ExpenseItem API field
// Required fields as follows:
// BillableToAccount : bool
// Description : String
// ExpenseCategory : ?
// ExpenseDate : Date
// ExpenseReportId : ID of associated expense report
// HaveReceipt : Boolean
// ID : String? (ID of expense item)
//
// Non-Required fields as follows:
// Miles : Int
// OdometerStart
// OdometerEnd
function buildAddExpenseItemsRequest(travelData, expenseReportID, resourceID, callback) // Note: Needs <create> tag surrounding the entity tag
{
	var queryStringHead = "<create xmlns='http://autotask.net/ATWS/v1_6/'><Entities>"
	var queryStringTail = "</Entities></create>"
	var query = ""
	var cachedItems = 0
	for (var i = 0; i < travelData.length; i++)
	{
		var day = travelData[i]
		for (var j = 0; j < day.length; j++)
		{
			var trip = day[j]

			var associatedAccount = trip.toAccountID
			if (associatedAccount == -1)
				associatedAccount = trip.fromAccountID
			if (associatedAccount == -1)
				continue

			if (accountIDToAnnualProjectMap[associatedAccount])
			{
				travelData[i][j].annualProjectID = accountIDToAnnualProjectMap[associatedAccount]
				trip.annualProjectID = travelData[i][j].annualProjectID
			}

			var ticketDate = trip.arriveTime
			if (ticketDate == -1)
				ticketDate = ticket.leaveTime
			if (ticketDate == -1)
				continue

			if (cachedExpenseItemHashes[hashTrip(trip)] && !ignoreCache)
			{
				console.log("Ignoring cached expense")
				cachedItems++
				continue
			}
			cachedExpenseItemHashes[hashTrip(trip)] = true
			var receiptAmount = parseFloat(trip.distance) * config.DOLLARS_PER_MILE

			query +=	"<Entity xsi:type='ExpenseItem' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance'>" +
						"<AccountID>" + associatedAccount + "</AccountID>" +
						"<ReceiptAmount>" + (Math.round(receiptAmount * 100) / 100) + "</ReceiptAmount>" +
						"<BillableToAccount>" + "True" + "</BillableToAccount>" +
						"<Description>" + TRAVEL_DESCRIPTION + " " + trip.fromName + " to " + trip.toName + "</Description>" +
						"<Destination>" + trip.toName + "</Destination>" +
						"<ExpenseCategory>" + 2 + "</ExpenseCategory>" + // 2 = Mileage
						"<ExpenseDate>" + formatDate(ticketDate) + "</ExpenseDate>" +
						"<ExpenseReportID>" + expenseReportID + "</ExpenseReportID>" +
						"<HaveReceipt>" + "True" + "</HaveReceipt>" +
						"<Miles>" + trip.distance + "</Miles>" +
						"<Origin>" + trip.fromName + "</Origin>" +
						"<PaymentType>" + 14 + "</PaymentType>" + // Associated with the "Expense Type" field. 14 = "Other"
					"</Entity>"
		}
	}

	//console.log("Request: " + queryStringHead + query + queryStringTail),
	sendRequest(queryStringHead + query + queryStringTail, resourceID, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var expenseItems = getCreateEntities(result)

			if (expenseItems == undefined || expenseItems.length == 0) // This would happen if all expenses were logged
			{
				if (cachedItems > 0)
				{
					addReturnLog(STATUS_ERR, "Skipped " + cachedItems + " previously generated expense items by default. You can change this behavior in the extension's settings", resourceID)
					callback(undefined)
				}
				else
				{
					//console.log("Query: " + query)
					addReturnLog(STATUS_ERR, "Failed to create new expense items. Response:\n" + JSON.stringify(result), resourceID)
					callback(undefined)
				}
			}
			else
			{
				if (cachedItems > 0)
				{
					addReturnLog(STATUS_WARN, "Ignoring " + cachedItems + " previously generated expense items by default. You can change this behavior in the extension's settings", resourceID)
				}
				//console.log(j(result))
				addReturnLog(STATUS_GOOD, "Created " + expenseItems.length + " expense items", resourceID)
				callback("true")
			}
			//callback(result)
		})
	}, "create")
}

// Uses the __ API field
// Uses the TimeEntry API field
// Required Fields:
// DateWorked : Date
// id : String?
// ResourceID
// RoleID
// Type : pick from a list of options
//
// Non-required fields:
// StartDateTime
// EndDateTime
// ContractID
// SummaryNotes
// TaskID
function buildAddTravelTimeRequest(travelData, resourceID, callback)
{
	buildResourceRoleQuery(resourceID, function(entities) {
		if (entities == undefined || entities.length == 0)
		{
			addReturnLog(STATUS_ERR, "Unable to find a role (i.e 'field', 'grid') for resource: " + resourceID, resourceID)
			callback(undefined)
			return
		}

		var resourceIDs = []
		//console.log(j(entities))
		for (var i = 0; i < entities.length; i++)
		{
			resourceIDs.push(entities[i].RoleID[0]._)
		}
		
		buildRolesQuery(resourceIDs, resourceID, function(roles) {  // A single resource can have multiple roles so loop through them
			var roleID = -1
			for (var i = 0; i < roles.length; i++)
			{
				if (roles[i].Name[0]._.indexOf("Field") >= 0)  // The resource is a field technician
				{
					roleID = roles[i].id[0]
					i = roles.length
				}
			}

			if (roleID == -1)
			{
				addReturnLog(STATUS_ERR, "You are not a field technician!", resourceID)
				callback(undefined)
			}
			else
			{
				var queryStringHead = "<create xmlns='http://autotask.net/ATWS/v1_6/'><Entities>"
				var queryStringTail = "</Entities></create>"
				var query = ""
				for (var i = 0; i < travelData.length; i++)
				{
					var day = travelData[i]
					for (var j = 0; j < day.length; j++)
					{
						var trip = day[j]
						//log("Trip", JSON.stringify(trip))
						
						if (!config.LOG_FIRST_TRAVEL_TIME_ENTRY_OF_DAY)
						{
							if (trip.fromAccountID == -1)
								continue
						}
						if (!config.LOG_LAST_TRAVEL_TIME_ENTRY_OF_DAY)
						{
							if (trip.toAccountID == -1)
								continue
						}

						if (trip.totalTimeHours == 0)
						{
							addReturnLog(STATUS_WARN, "Skipping time entry for the trip from " + trip.fromName + " to " + trip.toName + " on " + new Date(trip.startTime).toLocaleString() + "\nReason: travel time has been calculated as 0 minutes", resourceID)
							continue
						}
						//console.log("Trip before: " + JSON.stringify(travelData][i][j]))

						var associatedAccount = trip.toAccountID
						if (associatedAccount == -1)
							associatedAccount = trip.fromAccountID
						if (associatedAccount == -1)
						{
							addReturnLog(STATUS_WARN, "Unable to find the accounts " + trip.fromName + " and " + trip.toName, resourceID)
							continue
						}

						if (accountIDToAnnualProjectMap[associatedAccount])
						{
							travelData[i][j].annualProjectID = accountIDToAnnualProjectMap[associatedAccount]
							trip.annualProjectID = travelData[i][j].annualProjectID
							trip.taskID = annualProjectIDToTaskIDMap[trip.annualProjectID]
						}

						// Check to make sure, some accounts don't have associated annual projects (like Oakmont main office)
						if (trip.taskID == undefined)
						{
							if (trip.fromAccountID >= 0)
							{
								associatedAccount = trip.fromAccountID
								if (accountIDToAnnualProjectMap[associatedAccount])
								{
									travelData[i][j].annualProjectID = accountIDToAnnualProjectMap[associatedAccount]
									trip.annualProjectID = travelData[i][j].annualProjectID
									trip.taskID = annualProjectIDToTaskIDMap[trip.annualProjectID]
								}
							}
						}

						if (trip.taskID == undefined) // Don't log this, give an error warning
						{
							addReturnLog(STATUS_WARN, "Unable to find the travel task for the annual project associated with: " + associatedAccount, resourceID)
							continue
						}


						var associatedAccount = trip.toAccountID
						if (associatedAccount == -1)
							associatedAccount = trip.fromAccountID
						if (associatedAccount == -1)
							continue

						var ticketDate = trip.arriveTime
						if (ticketDate == -1)
							ticketDate = ticket.leaveTime
						if (ticketDate == -1)
							continue

						if (cachedTimeEntryHashes[hashTrip(trip)] && !ignoreCache)
						{
							console.log("Ignoring cached trip")
							continue
						}
						cachedTimeEntryHashes[hashTrip(trip)] = true

						query +="<Entity xsi:type='TimeEntry' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance'>" +
								"<DateWorked>" + formatDate(ticketDate) + "</DateWorked>" +
								"<EndDateTime>" + formatDate(trip.arriveTime) + "</EndDateTime>" +
								"<ResourceID>" + resourceID + "</ResourceID>" +
								"<RoleID>" + roleID + "</RoleID>" + // Associated with the "Expense Type" field. 14 = "Other"
								"<StartDateTime>" + formatDate(trip.leaveTime) + "</StartDateTime>" +
								"<SummaryNotes>" + TRAVEL_DESCRIPTION + " " + trip.fromName + " to " + trip.toName + "</SummaryNotes>" +
								"<TaskID>" + trip.taskID + "</TaskID>" +
								"<Type>" + 12 + "</Type>" +  // 12 is TravelTime
							"</Entity>\n\n"
					}
				}

				//log("Query", query.replaceAll("<", "\n") + "\n")
				//console.log("timeRequest: " + queryStringHead + query + queryStringTail)
				
				sendRequest(queryStringHead + query + queryStringTail, resourceID, function(apiResponse) {
					xml2js(apiResponse, function(err, result) {
						var timeEntries = getCreateEntities(result)
						if (timeEntries == undefined || timeEntries.length == 0)
						{
							addReturnLog(STATUS_ERR, "No travel time entries create. Response:\n" + result, resourceID)
							callback(undefined)
						}
						else
						{
							//console.log(j(result))
							callback(true)
						}
					})
				}, "create")
			}
		})
	})	
}

function getFieldInfo(entity, callback, resourceID = "null")
{

	var query = "<GetFieldInfo xmlns='http://autotask.net/ATWS/v1_6/'><psObjectType>" + entity +"</psObjectType></GetFieldInfo>"

	//console.log(queryStringHead + query + queryStringTail)

	sendRequest(query, resourceID, function(apiResponse) {
		callback(apiResponse)
	}, "GetFieldInfo")
}

function getThresholdAndUsageInfo(callback, resourceID = "null")
{
	var query = "<GetThresholdAndUsageInfo xmlns='http://autotask.net/ATWS/v1_6/'></GetThresholdAndUsageInfo>"

	//console.log(queryStringHead + query + queryStringTail)

	sendRequest(query, resourceID, function(apiResponse) {
		console.log("Done")
		callback(apiResponse)
	}, "getThresholdAndUsageInfo", true) // Case sensitive
}

var returnMessage = {} 
function addReturnLog(messageStatus, message, resourceID = "null")
{
	if (!returnMessage[resourceID])
	{
		returnMessage[resourceID] = []
	}
	
	// TODO: Make each response unique per user
	returnMessage[resourceID].push({"status": messageStatus, "message": message})
}

//Note: These values are actually TimeEntries from the API, not technically tickets. Just easier to understand this way I think
function parseTicketsInformation(tickets, resourceID, callback)
{
	if (tickets == undefined || tickets.length == 0)
	{
		addReturnLog(STATUS_ERR, "No tickets were returned", resourceID)
		callback(undefined)
	}

	var ticketsData = []
	for (var i = 0; i < tickets.length; i++)
	{
		var ticket = tickets[i]

		if (ticket == undefined) continue
		if (ticket.Type[0]._  == "6")  // Ignore all Travel related time entries (really we probably only want to log tickets where type = 2)
			continue

		var ticketData = {}

		ticketData.StartDateTime = ticket.StartDateTime[0]._
		ticketData.EndDateTime = ticket.EndDateTime[0]._
		ticketData.ContractID = ticket.ContractID[0]._

		ticketsData.push(ticketData)
	}

	ticketsData = sortTickets(ticketsData)

	//console.log("Before: " + j(ticketsData))

	//var contractIDs = ticketsData.map((val) => val.ContractID)
	//callback(contractIDs) 
	callback(ticketsData)

}

// Inputs distances that are already cached. returns a tuple of [the number of entries that were not found in the cache, updated travel data]
function loadCachedTravelData(travelData)
{
	//console.log("TravelMap: " + j(travelDistanceMap))
	var totalDrives = 0
	var totalCached = 0
	for (var i = 0; i < travelData.length; i++) // Iterate over every days data
	{
		var dayData = travelData[i]
		for (var j = 0; j < dayData.length; j++) // Iterate over the data for the day
		{
			totalDrives++
			var trip = dayData[j]
			var fromID = trip.fromAccountID
			var toID = trip.toAccountID

			//log("Travel data", trip.fromName + " " + trip.toName + " " +0
			if (travelDistanceMap[fromID] && travelDistanceMap[fromID][toID]) // if we have this data cached
			{
				travelData[i][j].distance = travelDistanceMap[trip.fromAccountID][trip.toAccountID][0]
				totalCached++
			}
			else if (fromID == -1) // came from home
			{
				//console.log("Trip: " + j(trip))
				if (travelDistanceMap["Home"] && travelDistanceMap["Home"][toID])
				{
					//console.log("Home map: " + j(travelDistanceMap["Home"]))
					travelData[i][j].distance = travelDistanceMap["Home"][trip.toAccountID][0]
					travelData[i][j].leaveTime = new Date(new Date(trip.arriveTime) - (travelDistanceMap["Home"][trip.toAccountID][1] * 3600 * 1000)).toString()
					//console.log("Time after: " + trip.leaveTime)
					totalCached++
				}
			}
			else if (toID == -1)
			{
				if (travelDistanceMap[fromID] && travelDistanceMap[fromID]["Home"])
				{
					travelData[i][j].distance = travelDistanceMap[trip.fromAccountID]["Home"][0]
					travelData[i][j].arriveTime = new Date(new Date(trip.leaveTime).getTime() + (travelDistanceMap[trip.fromAccountID]["Home"][1] * 3600 * 1000)).toString() // Had to be careful with adding dates
					totalCached++
				}
			}
			else
			{
				//console.log("Don't know: " + trip.fromName + " == " + trip.toName)
			}
			travelData[i][j].totalTimeHours = roundToNearest15(travelData[i][j].leaveTime, travelData[i][j].arriveTime)
		}
	}

	return [totalDrives - totalCached, travelData]
}

Set.prototype.toArray = function()
{
	var arr = []
	var iter = this.values()
	var val = iter.next()
	while (!val.done)
	{
		arr.push(val.value)
		val = iter.next()
	}

	return arr
}

var MAX_MATRIX_ELEMENTS = 100
// Recurses one time in order to 
function getDistanceData(travelData, nodeResponse, requesterID, callback, recursing = false, originParamsOffset = 0)
{
	var cacheData = loadCachedTravelData(travelData)

	//log("Cache data", cacheData[1].length)
	var uncachedTrips = cacheData[0]
	//log("UncachedTrips", uncachedTrips + "\n\n")
	travelData = cacheData[1]

	// Recursive base case
	if (uncachedTrips == 0)
	{
		//nodeResponse.end(j(travelData))

		callback(travelData)
		return
	}

	if (recursing)
	{
		addReturnLog("Error", "Google maps was unable to find an address for a school", requesterID)
		callback(undefined)
		return
	}

	var apiURL = "https://maps.googleapis.com/maps/api/distancematrix/json?"

	var originParams = new Set()
	var destParams = new Set()

	for (var i = 0; i < travelData.length; i++) // Iterate over every days data
	{
		var dayData = travelData[i]
		for (var j = 0; j < dayData.length; j++) // Iterate over the data for the day
		{
			var trip = dayData[j]
			var fromID = trip.fromAccountID
			var toID = trip.toAccountID

			//log("Finding addresses for trip", trip.fromName + " " + trip.toName + " " + trip.fromAddress + " " + trip.toAddress)
			if (travelDistanceMap[fromID] && travelDistanceMap[fromID][toID]) // if we have this data cached
			{
				continue
			}
			else
			{
				originParams.add(trip.fromAddress)
				destParams.add(trip.toAddress)
			}
		}
	}

	originParams = originParams.toArray()
	destParams = destParams.toArray()
	var matrixSize = originParams.length * destParams.length
	//log("Matrix size", matrixSize + " " + originParams.length + " " + destParams.length)
	var originChunkSize = 0
	if (matrixSize >= MAX_MATRIX_ELEMENTS)
	{
		originChunkSize = parseInt(100 / destParams.length)
		originParams = originParams.slice(originParamsOffset, originParamsOffset + originChunkSize)
	}

	//log("Origin before", JSON.stringify(originParams))
	var addresses = originParams.concat(destParams)

	//log("Origin after", JSON.stringify(originParams))
	var requestURL = apiURL + "origins="+ originParams.join("|") + "&units=" + imperialOrMetric + "&destinations=" + destParams.join("|" )+ "&key=" + config.MAPS_API_KEY

	//console.log(requestURL)
	https.get(requestURL, (resp) => {
  		let data = '';

		// A chunk of data has been recieved.
		resp.on('data', (chunk) => {
			data += chunk;
		});

		// The whole response has been received. Print out the result.
		resp.on('end', () => {
			//log("Data", data)
			parseDistanceMatrix(data, addresses, function() {
				if (matrixSize >= MAX_MATRIX_ELEMENTS)
					getDistanceData(travelData, nodeResponse, requesterID, callback, false, originParamsOffset + originChunkSize)
				else
					getDistanceData(travelData, nodeResponse, requesterID, callback, true)

			})
		})

		resp.on("error", (err) => {
			console.log("Error: " + err.message);
		})
	})
}

function parseDistanceMatrix(matrix, addresses, callback)
{
	//console.log(j(addressToAccountIDMap))
	data = JSON.parse(matrix)
	//console.log("Data: " + matrix)

	//console.log(matrix)

	var destinations = data.destination_addresses
	var origins = data.origin_addresses
	var distances = data.rows

	for (var o = 0; o < origins.length; o++)
	{
		var elements = distances[o].elements
		var origin = origins[o]
		//log("From", origin)
		for (var d = 0; d < destinations.length; d++)
		{
			var values = elements[d]
			var distanceMiles = Math.ceil(values.distance.value / 1608) // Convert meters to miles and round up
			var timeHours = Math.ceil((values.duration.value / 3600) * 4) / 4  // Convert seconds to hours and round up to the nearest 15

			//Not used currently
			var estimatedTime = values.duration.value / 3600.0 // convert seconds to hours
			estimatedTime = Math.ceil(estimatedTime * 4) / 4 // Round up to the nearest quarter hour

			var dest = destinations[d]
			var fromAddressConversion = findAddress(origin, addresses)    // Has to compare the Autotask addresses with the returned Google Maps addresses
			var toAddressConversion = findAddress(dest, addresses)    // Basically just finds the address with the longest matching substring

			var fromID = addressToAccountIDMap[fromAddressConversion[1]]
			var toID = addressToAccountIDMap[toAddressConversion[1]]

			if (fromID == undefined) fromID = "Home"
			if (toID == undefined) toID = "Home"

			//log("To", dest)

			if (travelDistanceMap[fromID] && travelDistanceMap[fromID][toID]) // if we have this data cached
				continue

			if (!travelDistanceMap[fromID])
				travelDistanceMap[fromID] = {}
			if (!travelDistanceMap[toID])
				travelDistanceMap[toID] = {}

			//log("Caching from", fromAddressConversion)
			//log("Caching to  ", toAddressConversion)

			travelDistanceMap[fromID][toID] = [distanceMiles, timeHours]
			travelDistanceMap[toID][fromID] = [distanceMiles, timeHours]
		}
	}

	callback()
}

function authenticateUserRequest(postParams, resourceID, callback)
{
	var email = clean(postParams["emailAddress"])
	var homeAddress = clean(postParams["homeAddress"])
	var authToken = clean(postParams["authToken"])
	var mostRecentTickets = postParams["recentTickets"]
	var mostRecentExpenseReports = postParams["recentExpenseReports"]
	var rewriteData = !!postParams["writeAgain"]

	if (email == undefined)
	{
		addReturnLog(STATUS_ERR, "User email address ('email'): <i>undefined<i>")
		callback(undefined)
		return
	}
	if (homeAddress == undefined)
	{
		addReturnLog(STATUS_ERR, "User home address ('homeAddress'): <i>undefined<i>")
		callback(undefined)
		return
	}
	if (authToken == undefined && false) // TODO : temp bypass
	{
		addReturnLog(STATUS_ERR, "No Autotask auth token ('authToken')) has been provided")
		callback(undefined)
		return
	}
	if (rewriteData == undefined)
	{
		addReturnLog(STATUS_ERR, "You must specify whether you want to rewrite ticket data even if it has been previously uploaded ('writeAgain')")
		callback(undefined)
		return
	}

	ignoreCache = rewriteData

	if (emailToAuthTokenMap[email] == authToken)
	{
		callback(email, homeAddress)
		return
	}
	
	var queryStringHead = ""
	var query = ""
	var queryStringTail = ""

	var desiredResponseLength = -1
	if (mostRecentExpenseReports != undefined)    // We are uploading expense report data
	{
		var expenseReportNames = mostRecentExpenseReports["expenseReportNames"]
		var expenseReportPeriodsEnding = mostRecentExpenseReports["periodsEnding"]
		var expenseReportAmountsDue = mostRecentExpenseReports["amountsDue"]

		if (expenseReportNames == undefined || expenseReportPeriodsEnding == undefined || expenseReportAmountsDue == undefined)
		{
			addReturnLog(STATUS_ERR, "Misformed POST data", resourceID)
			callback(undefined)
			return
		}
		if  (expenseReportNames.length == 0 || expenseReportPeriodsEnding.length == 0 || expenseReportAmountsDue.length == 0)
		{
			addReturnLog(STATUS_ERR, "Misformed POST data", resourceID)
			callback(undefined)
			return
		}
		if  (expenseReportNames.length != expenseReportPeriodsEnding.length || expenseReportPeriodsEnding.length != expenseReportAmountsDue)
		{
			addReturnLog(STATUS_ERR, "Misformed POST data", resourceID)
			callback(undefined)
			return
		}
		desiredResponseLength = expenseReportNames.length
		
		var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>ExpenseReport</entity><query>"
		var query1 = "<field>Name"
		var query2 = "<field>WeekEnding"
		var query3 = "<field>AmountDue"

		for (var i = 0; i < expenseReportNames.length; i++)
		{
			query1 +=  "<expression op='equals'>" + expenseReportNames[i] + "</expression>"
			query2 += "<expression op='equals'>" + expenseReportPeriodsEnding[i] + "</expression>"
			query3 += "<expression op='equals'>" + expenseReportAmountsDue[i] + "</expression>"
		}
		query1 += "</field>"
		query2 += "</field>"
		query3 += "</field>"

		var query4 = "<field>SubmitterID<expression op='equals'>" + resourceID + "</expression></field>"

		query = query1 + query2 + query3 + query4
		queryStringTail = "</query></queryxml>]]></sXML></query>"
	}
	else if (mostRecentTickets != undefined)
	{
		var ticketNumbers = mostRecentTickets["ticketNumbers"]
		var ticketTimesWorked = mostRecentTickets["timesWorked"]

		if (ticketNumbers== undefined || ticketTimesWorked == undefined)
		{
			addReturnLog(STATUS_ERR, "Misformed POST data", resourceID)
			callback(undefined)
			return
		}
		if  (ticketNumbers.length == 0 || ticketTimesWorked.length == 0)
		{
			addReturnLog(STATUS_ERR, "Misformed POST data", resourceID)
			callback(undefined)
			return
		}
		if  (ticketNumbers.length != ticketTimesWorked.length)
		{
			addReturnLog(STATUS_ERR, "Misformed POST data", resourceID)
			callback(undefined)
			return
		}
		desiredResponseLength = ticketNumbers.length

		var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>Ticket</entity><query>"
		var query1 = "<field>TicketNumber"
		//var query2 = "<field>"

		for (var i = 0; i < expenseReportNames.length; i++)
		{
			query1 +=  "<expression op='equals'>" + ticketNumbers[i] + "</expression>"
			//var query2 += "<expression op='equals'>" + expenseReportPeriodsEnding[i] + "</expression>"
			//var query3 += "<expression op='equals'>" + expenseReportAmountsDue[i] + "</expression>"
		}
		query1 += "</field>"
		query2 += "</field>"
		query3 += "</field>"

		var query4 = "<field>SubmitterID<expression op='equals'>" + resourceID + "</expression></field>"

		query = query1// + query2 + query3 + query4
		queryStringTail = "</query></queryxml>]]></sXML></query>"

	}
	else
	{
		addReturnLog(STATUS_ERR, "No relevant travel data given to server", resourceID)
		callback(undefined)
		return
	}

	sendRequest(queryStringHead + query + queryStringTail, resourceID, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var entities = getEntities(result)

			if (entities== undefined || entities.length == 0 || entities.length != desiredResponseLength)
			{
				addReturnLog(STATUS_ERR, "It seems like you are trying to impersonate someone! This request has been logged.", resourceID) // No it hasn't :)
				addReturnLog(STATUS_WARN, "If this is an error, and it persists, please contact <b>Jacob Fakult<b>", resourceID)
				callback(undefined)
			}
			else
			{
				emailToAuthTokenMap[email] = authToken
				callback(email, homeAddress)
			}
			//callback(result)
		})
	})
}

module.exports =
{
	buildAddExpenseItemsRequest : buildAddExpenseItemsRequest,

	buildAddTravelTimeRequest: buildAddTravelTimeRequest,

	buildFindExpenseReportQuery : buildFindExpenseReportQuery,

	buildCreateExpenseReportRequest : buildCreateExpenseReportRequest,

	formatDate : formatDate,

	buildTicketsQueryRequest : buildTicketsQueryRequest,

	sendRequest : sendRequest,

	buildResourceQueryRequest : buildResourceQueryRequest,
	
	buildContractIDsQueryRequest : buildContractIDsQueryRequest,

	buildAccountIDsQueryRequest : buildAccountIDsQueryRequest,

	getEntities : getEntities,

	extrapolateTravelData : extrapolateTravelData,

	sortTickets : sortTickets,

	j : j,

	travelDistanceMap : travelDistanceMap,

	addressToAccountIDMap: addressToAccountIDMap,

	findAddress : findAddress,

	buildUploadDataRequest : buildUploadDataRequest,

	getFieldInfo : getFieldInfo,
	
	getThresholdAndUsageInfo : getThresholdAndUsageInfo,

	buildFindTravelProjectQuery : buildFindTravelProjectQuery,
	
	buildFindTravelProjectTaskQuery : buildFindTravelProjectTaskQuery,

	buildRolesQuery : buildRolesQuery,
	
	buildResourceRoleQuery : buildResourceRoleQuery,

	roundToNearest15 : roundToNearest15,

	returnMessage : returnMessage,

	addReturnLog : addReturnLog,

	parseTicketsInformation : parseTicketsInformation,

	getDistanceData : getDistanceData,

	authenticateUserRequest : authenticateUserRequest,

	buildGenericQuery : buildGenericQuery,

	clean : clean

}; // Closing bracket of module exports

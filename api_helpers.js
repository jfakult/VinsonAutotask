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

var emailToAuthTokenMap = {}
var emailToResourceIDMap = {}
var contractIDToAccountIDMap = {}
var travelDistanceMap = {}
var addressToAccountIDMap = {}
var accountIDToAnnualProjectMap = {}
var annualProjectIDToTaskIDMap = {}

var accountInformation = {}
//var travelDistanceData = {}
var imperialOrMetric = "imperial"
var ignoreCache = false

var cachedTimeEntryHashes = {}   // This should probably be saved in a database but this is fine for now...
var cachedExpenseItemHashes = {} // Just don't restart the server more often that monthly...

/*var requestHeader = `
<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <soap12:Header>` +
    //`<soap12:upgrade xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:supportedenvelope qname="soap:Envelope" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap12:supportedenvelope qname="soap12:Envelope" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"></soap12:supportedenvelope></soap12:supportedenvelope></soap12:upgrade>` +
	  `<AutotaskIntegrations xmlns="http:autotask.net/ATWS/v1.6/">
	    <IntegrationCode>` + privateData.TRACKING_IDENTIFIER + `</IntegrationCode>` +
	    //`<ImpersonateAsResourceID></ImpersonateAsResourceID>` +
	  `</AutotaskIntegrations>
	</soap12:Header>
	<soap:Body> `
//	`<getThresholdAndUsageInfo xmlns="http://autotask.net/ATWS/v1_6/"></getThresholdAndUsageInfo>` +
var requestTail = `
	</soap:Body>
  </soap:Envelope>`*/

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
//"<ImpersonateAsResourceID>" +
// For version 1.6 only insert id of a resource you want to impersonate
//"</ImpersonateAsResourceID>" +
"</AutotaskIntegrations>" +
"</soap:Header>" +
"<soap:Body>"
//"<getThresholdAndUsageInfo xmlns='http://autotask.net/ATWS/v1_6/'></getThresholdAndUsageInfo>" // To use version 1.6 change to http://autotask.net/ATWS/v1_6/
var requestTail = "</soap:Body>" +
"</soap:Envelope>";

// Cleaning up inputs to deny string injection attacks
function clean(val)
{
	return val.replace(/[|&;$%@"'<>()+,]/g, "");
}

function log(tag, msg)
{
	console.log(tag + ": " + msg)
}

function makeParam(name, value)
{
	name = clean(name)
	value = clean(value)
	return '<param name="' + name + '">' + value + '</param>'
}

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

function buildTicketsQueryRequest(resourceID, generatingTravelTimes, callback) // Queries for a list of all tickets since "last monday"
{
	var lastMonday = new Date()
	lastMonday.setHours(0)
	lastMonday.setMinutes(0)

	if (generatingTravelTimes)
	{
		lastMonday.setDate(lastMonday.getDate() - ((lastMonday.getDay() + 6) % 7)) // Sets date to last Monday. Don't ask me for a mathematical proof
	}
	else
	{
		lastMonday.setDate(1)
	}

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>TimeEntry</entity><query><field>StartDateTime"
	var queryBody = "<expression op='greaterthan'>" + formatDate(lastMonday) + "</expression>"
	queryBody += "</field><field>ResourceID<expression op='equals'>" + resourceID + "</expression>"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"

	sendRequest(queryStringHead + queryBody + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			if (result)
			{
				var tickets = getEntities(result)
				
				callback(tickets)
			}
			else
			{
				addReturnLog("error", "No tickets were found for resource: " + resourceID)
				callback(undefined)
			}
		})
	})
}

function buildResourceQueryRequest(resourceEmail, callback)
{
	if (emailToResourceIDMap[resourceEmail] != undefined)
		callback(emailToResourceIDMap[resourceEmail])

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>Resource</entity><query><field>Email"
	var queryBody = "<expression op='equals'>" + resourceEmail + "</expression>"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"

	sendRequest(queryStringHead + queryBody + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var resources = getEntities(result)
			if (resources.length > 0)
			{
				callback(resources[0].id[0])
			}
			else
			{
				addReturnLog("error", "No resources found that match the email: " + resourceEmail)
				callback(undefined)
			}
		})
	})
}

// Note: Since this function makes all calls asynchronously, the account IDs may come back out of order. Use the map to ensure you have the correct account when referencing
function buildContractIDsQueryRequest(contractIDs, callback)
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

	sendRequest(queryStringHead + queries + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			//console.log("---" + JSON.stringify(result))
			var contracts = getEntities(result)

			if (contracts != undefined && contracts.length > 0) // Will come back empty if all trips are cached
			{
				for (var i = 0; i < contracts.length; i++)
				{
					accountID = contracts[i].AccountID[0]._

					contractIDToAccountIDMap[contracts[i].id[0]] = accountID

					accountIDs.push(accountID)
				}

				callback(accountIDs)
			}
			else
			{
				addReturnLog("error", "No accounts returned from list of contracts: " + j(contractIDs))
				callback(undefined)
			}
		})
	})
}

function j(str)
{
	return JSON.stringify(str, null, 4)
}

function buildAccountIDsQueryRequest(accountIDs, callback)
{
	var accountsData = {}

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>Account</entity><query><field>id"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"
	var queries = ""
	for (var i = 0; i < accountIDs.length; i++)
	{
		queries += "<expression op='equals'>" + accountIDs[i] + "</expression>"
	}

	sendRequest(queryStringHead + queries + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var accounts = getEntities(result)

			if (accounts == undefined || accounts.length == 0)
			{
				addReturnLog("error", "No accounts found with IDs: " + j(accountIDs))
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

				addressToAccountIDMap[getAccountAddress(accountData)] = accounts[i].id[0]
				accountsData[accounts[i].id[0]] = accountData
			}

			callback(accountsData)
		})
	})

}
function sendRequest(soapXML, callback, action = "query", log = false)
{
	soapXML = requestHeader + soapXML + requestTail

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

	var index = 0

	responseData = ""

	request = https.request(SOAP_OPTIONS, function (res) {
		//console.log("statusCode:", res.statusCode);
		//console.log('headers:', res.headers);
		
		res.on("data", (d) => {
			if (log)
				console.log("Send: " + d.toString());
			responseData += d.toString()
			//callback(responseData)
		});

		res.on("end", () => {
			console.log(action + " recieved")
			callback(responseData)
		});
	});

	request.on("error", (e) => {
	    console.error("error sending request: " + e);
	});

	//console.log(soapXML)
	//callback(soapXML)
	request.end(soapXML.toString())	
}

function getEntities(xmlObject)
{
	try
	{
		return xmlObject["soap:Envelope"]["soap:Body"][0].queryResponse[0].queryResult[0].EntityResults[0].Entity
	}
	catch (e) { return undefined }
}

function getCreateEntities(xmlObject)
{
	try
	{
		return xmlObject["soap:Envelope"]["soap:Body"][0].createResponse[0].createResult[0].EntityResults[0].Entity
	}
	catch (e) { return undefined }
}

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

function getAccountAddress(accountData)
{
	return accountData.Address1 + " " + accountData.City + ", " + accountData.State + " " + accountData.PostalCode
}

function roundToNearest15(startTime, endTime, inc = 4) // Round the hour into "inc" (increments) chunks. inc = 2 rounds to the half hour. 4 rounds to the nearest 15 mins
{
	var hours = ((new Date(endTime) - new Date(startTime)) / 1000) / 3600

	var roundedHours = Math.round(hours * inc) / inc     // round to every quarter hour

	return roundedHours
}

function extrapolateTravelData(ticketsData, accountsData, homeAddress, resourceID, callback)
{
	var travelData = []  // An array where each index has the travel data for a single day (travelData[0] is Monday's travel data, etc)

	//var lastFromAddress = homeAddress
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
		addReturnLog("error", "No recent tickets have been found for you!")
		callback(undefined)
		return
	}

	//log("Map", j(contractIDToAccountIDMap))
	var travelForDay = []      // Stores the information for a single day of travelling
	var trip = {}
	for (var i = 0; i < ticketsData.length; i++)
	{
		//console.log("Ticket incoming: " + j(ticketsData[i]))
		var ticket = ticketsData[i]
		var trip = {}
		trip.resourceID = resourceID
		//log("Ticket", j(ticket))

		var ticketAccountID = contractIDToAccountIDMap[ticket.ContractID]

		if (ticketAccountID == undefined) // This should never happen?
		{
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

		// Log data for arriving home and the new day
		if (ticketDay != currentDay)
		{
			//console.log("New day")
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

			//lastFromAddress = homeAddress
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
	
		//lastFromAddress = lastToAddress
		lastToAddress = accountAddress
		lastTicketEndTime = ticket.EndDateTime
		lastAccountID = ticketAccountID
		lastFromName = accountName

		//log("Trip2", j(trip))

		travelForDay.push(trip)
	}

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

//Sorts tickets by EndDateTime (day then time)
function sortTickets(tickets)
{
	tickets.sort(function(a, b) {
	    	return (new Date(a.EndDateTime) - new Date(b.EndDateTime));
	});

	return tickets
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
		addReturnLog("error", "No travel data was found")
		callback(undefined)
		return
	}

	var firstTrip = travelData[0][0]
	var lastTrip = travelData[travelData.length - 1][travelData.slice(-1)[0].length -1] // Javascript magic

	//console.log("Trip dates: " + j(travelData[0][0]))
	var startMonth = months[ (new Date(firstTrip.arriveTime)).getMonth() ]  //arrive because it is the first non-home trip of the month
	var endMonth = months[ (new Date(lastTrip.leaveTime)).getMonth() ]	//leave for same reason as above

	var startYear = (new Date(firstTrip.arriveTime)).getFullYear()
	var endYear = (new Date(lastTrip.leaveTime)).getFullYear()
	var splitIndex = months[startMonth]

	// If the week crossed through the month, we need to create expense reports for both months
	// Thus, this for loop iterates over the travelData to find which day of the week starts the new month
	if (startMonth != endMonth)
	{
		for (var i = 0; i < travelData.length; i++)
		{
			var day = travelData[i]
			if (day == undefined || day.length == 0)
				continue

			if (splitIndex != months[new Date(day[0].arriveTime).getMonth()])
			{
				splitIndex = i  // Change the data type of the index from a month name to an index value then exit the for loop
				break
			}
		}
	}

	var startDesiredName = EXPENSE_TITLE + " for " + startMonth + " " + startYear
	var endDesiredName = EXPENSE_TITLE + " for " + endMonth + " " + endYear

	buildFindExpenseReportQuery(startDesiredName, function(startExpenseReportID) {   // Technically this may cause issues for the edge case
		if (startExpenseReportID == -1)					         // Where the user creates expense reports for the entire year
		{								         // AND calls them by the exact same name as this program wants to call them
			buildCreateExpenseReportRequest(startDesiredName, firstTrip.arriveTime, requesterID, function(newStartExpenseReportID) {
				if (startMonth != endMonth)
				{
					buildCreateExpenseReportRequest(endDesiredName, lastTrip.leaveTime, requesterID, function(endExpenseReportID) {
						
						buildAddExpenseItemsRequest(travelData.slice(0, splitIndex), newStartExpenseReportID, function(apiResponse) {
						
							buildAddExpenseItemsRequest(travelData.slice(splitIndex), endExpenseReportID, function(apiResponse)  {
							
								callback(apiResponse)

							})
						})
					})
				}
				else
				{
					buildAddExpenseItemsRequest(travelData, newStartExpenseReportID, function(apiResponse) {

						callback(apiResponse)

					})
				}
			})
		}
		else if (startMonth != endMonth) // Split tickets into two sections
		{
			buildFindExpenseReportQuery(endDesiredName, function(endExpenseReportID) {

				buildCreateExpenseReport(endDesiredName, lastTrip.leaveTime, requesterID, function(endExpenseReportID) {

					buildAddExpenseItemsRequest(travelData.slice(0, splitIndex), newStartExpenseReportID, function(apiResponse) {

						buildAddExpenseItemsRequest(travelData.slice(splitIndex), endExpenseReportID, function(apiResponse)  {

							callback(apiResponse)

						})
					})
				})
			})
		}
		else
		{
			buildAddExpenseItemsRequest(travelData, startExpenseReportID, function(apiResponse) {
				//console.log(j(apiResponse))
				callback(apiResponse)
			})
		}
	})
}

function buildFindTravelProjectTaskQuery(projectIDs, callback)
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

	sendRequest(queryStringHead + query + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var projects = getEntities(result)
			if (projects == undefined || projects.length == 0)
			{
				addReturnLog("error", "No tasks found for annual projects with IDs: " + j(projectIDs))
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

// For there seems to be some glitch in the API where having multiple expressions per field and multiple fields
// The result is that only the first expression is evaluated and the others are ignored
function buildFindTravelProjectQuery(accountIDs, callback)
{
	var projectIDs = []
	var currentYear = new Date()
	var endYear = currentYear.getFullYear()
	if (currentYear.getMonth() >= 7) // Starting from August, the new project will be ending during the next fiscal year
		endYear++
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
	sendRequest(queryStringHead + query + queryStringTail, function(apiResponse) {
		//console.log(apiResponse)
		xml2js(apiResponse, function(err, result) {
			var projects = getEntities(result)
			if (projects == undefined || projects.length == 0)
			{
				addReturnLog("error", "No annual projects were found to be associated with any accounts")
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

function buildRolesQuery(resourceIDs, callback)
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
	sendRequest(queryStringHead + query + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var reports = getEntities(result)
			if (reports == undefined || reports.length == 0)
			{
				addReturnLog("warning", "No roles found for resources: " + j(resourceIDs) + " (this means these people likely aren't field technicians)")
				callback([])
			}
			else
			{
				//console.log(j(reports))
				reportID = reports[0].id[0]

				callback(reportID)
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

	sendRequest(queryStringHead + query + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var reports = getEntities(result)
			if (reports == undefined || reports.length == 0)
			{
				addReturnLog("error", "No ResourceRoles associated with resource: " + resourceID + " (This means you are not a field technician)")
				callback(undefined)
			}
			else
			{
				callback(reports)
			}
		})
	})

}

function buildFindExpenseReportQuery(desiredName, callback)
{
	var reportID = -1

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>ExpenseReport</entity><query><field>name"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"

	var query = "<expression op='equals'>" + desiredName + "</expression>"

	sendRequest(queryStringHead + query + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var reports = getEntities(result)
			if (reports == undefined || reports.length == 0)
			{
				addReturnLog("warning", "No expense reports found found for this month (creating a new one)")
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

	sendRequest(queryStringHead + query + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var expenseReports = getCreateEntities(result)


			if (expenseReports == undefined || expenseReports.length == 0)
			{
				addReturnLog("error", "Failed to create new expense report.\nResponse:\n" + j(result))
				callback(undefined)
			}
			else
			{
				addReturnLog("success", "Successfully created expense report")
				callback(true)
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
function buildAddExpenseItemsRequest(travelData, expenseReportID, callback) // Note: Needs <create> tag surrounding the entity tag
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

			if (cachedExpenseItemHashes[hashTrip(trip)])
			{
				console.log("Ignoring cached expense")
				continue
			}
			cachedExpenseItemHashes[hashTrip(trip)] = true

			query +=	"<Entity xsi:type='ExpenseItem' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance'>" +
						"<AccountID>" + associatedAccount + "</AccountID>" +
						"<ReceiptAmount>" + parseFloat(trip.distance) * config.DOLLARS_PER_MILE + "</ReceiptAmount>" +
						"<BillableToAccount>" + "true" + "</BillableToAccount>" +
						"<Description>" + TRAVEL_DESCRIPTION + " " + trip.fromName + " to " + trip.toName + "</Description>" +
						"<Destination>" + trip.toName + "</Destination>" +
						"<ExpenseCategory>" + 2 + "</ExpenseCategory>" + // 2 = Mileage
						"<ExpenseDate>" + formatDate(ticketDate) + "</ExpenseDate>" +
						"<ExpenseReportID>" + expenseReportID + "</ExpenseReportID>" +
						"<HaveReceipt>" + "true" + "</HaveReceipt>" +
						"<Miles>" + trip.distance + "</Miles>" +
						"<Origin>" + trip.fromName + "</Origin>" +
						"<PaymentType>" + 14 + "</PaymentType>" + // Associated with the "Expense Type" field. 14 = "Other"
					"</Entity>"
		}
	}

	//console.log("Request: " + queryStringHead + query + queryStringTail),
	sendRequest(queryStringHead + query + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var expenseItems = getCreateEntities(result)

			if (expenseItems == undefined || expenseItems.length == 0) // This would happen if all expenses were logged
			{
				addReturnLog("error", "Failed to create new expense items. Response:\n" + JSON.stringify(result))
				callback(undefined)
			}
			else
			{
				//console.log(j(result))
				addReturnLog("success", "Created expense items")
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
	buildResourceRoleQuery(resourceID, function(apiResponse) {
		var entities = getEntities(apiResponse)
		var resourceIDs = []
		//console.log(j(entities))
		for (var i = 0; i < entities.length; i++)
		{
			resourceIDs.push(entities[i].RoleID[0]._)
		}
		
		buildRolesQuery(resourceIDs, function(apiResponse) {
			var entities = getEntities(apiResponse)
			var roleID = -1
			for (var i = 0; i < entities.length; i++)
			{
				if (entities[i].Name[0]._.indexOf("Field") >= 0)  // The resource is a field technician
				{
					roleID = entities[i].id[0]
					i = entities.length
				}
			}

			if (roleID == -1)
			{
				callback("You are not a Field Technician!")
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
							addReturnLog("warning", "Skipping time entry for the trip from " + trip.fromName + " to " + trip.toName + " on " + new Date(trip.startTime).toLocaleString() + "\nReason: travel time has been calculated as 0 minutes")
							continue
						}
						//console.log("Trip before: " + JSON.stringify(travelData][i][j]))

						var associatedAccount = trip.toAccountID
						if (associatedAccount == -1)
							associatedAccount = trip.fromAccountID
						if (associatedAccount == -1)
						{
							addReturnLog("warning", "Unable to find the accounts " + trip.fromName + " and " + trip.toName)
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
							addReturnLog("warning", "Unable to find the travel task for the annual project associated with: " + associatedAccount)
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

						if (cachedTimeEntryHashes[hashTrip(trip)])
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
				
				sendRequest(queryStringHead + query + queryStringTail, function(apiResponse) {
					xml2js(apiResponse, function(err, result) {
						var timeEntries = getCreateEntities(result)
						if (timeEntries == undefined || timeEntries.length == 0)
						{
							addReturnLog("error", "No travel time entries create. Response:\n" + result)
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

function getFieldInfo(entity, callback)
{
	var query = "<GetFieldInfo xmlns='http://autotask.net/ATWS/v1_6/'><psObjectType>" + entity +"</psObjectType></GetFieldInfo>"

	//console.log(queryStringHead + query + queryStringTail)

	sendRequest(query, function(apiResponse) {
		callback(apiResponse)
	}, "GetFieldInfo")
}

function getThresholdAndUsageInfo(callback)
{
	var query = "<GetThresholdAndUsageInfo xmlns='http://autotask.net/ATWS/v1_6/'></GetThresholdAndUsageInfo>"

	//console.log(queryStringHead + query + queryStringTail)

	sendRequest(query, function(apiResponse) {
		console.log("Done")
		callback(apiResponse)
	}, "getThresholdAndUsageInfo", true) // Case sensitive
}

var returnMessage = [] 
function addReturnLog(messageStatus, message)
{
	returnMessage.push({"status": messageStatus, "message": message})
}

//Note: These values are actually TimeEntries from the API, not technically tickets. Just easier to understand this way I think
function parseTicketsInformation(tickets, callback)
{
	if (tickets == undefined || tickets.length == 0)
	{
		addReturnLog("error", "No tickets were returned")
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
		addReturnLog("Error", "Google maps was unable to find an address for a school")
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
	var email = clean(postParams["email"])
	var address = clean(postParams["homeAddress"])
	var authToken = clean(postParams["authToken"])
	var mostRecentTickets = postParams["recentTickets"]
	var mostRecentExpenseReports = postParams["recentExpenseReports"]
	var rewriteData = !!postParams["writeAgain"]

	if (email == undefined)
	{
		addReturnLog("error", "User email address ('email'): <i>undefined<i>")
		callback(undefined)
		return
	}
	if (address == undefined)
	{
		addReturnLog("error", "User home address ('homeAddress'): <i>undefined<i>")
		callback(undefined)
		return
	}
	if (authToken == undefined)
	{
		addReturnLog("error", "No Autotask auth token ('authToken')) has been provided")
		callback(undefined)
		return
	}
	if (rewriteData == undefined)
	{
		addReturnLog("error", "You must specify whether you want to rewrite ticket data even if it has been previously uploaded ('writeAgain')")
		callback(undefined)
		return
	}

		ignoreCache = rewriteData

	if (emailToAuthTokenMap[email]) == authToken)
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
			addReturnLog("error", "Misformed POST data")
			callback(undefined)
			return
		}
		if  (expenseReportNames.length == 0 || expenseReportPeriodsEnding.length == 0 || expenseReportAmountsDue.length == 0)
		{
			addReturnLog("error", "Misformed POST data")
			callback(undefined)
			return
		}
		if  (expenseReportNames.length != expenseReportPeriodsEnding.length || expenseReportPeriodsEnding.length != expenseReportAmountsDue)
		{
			addReturnLog("error", "Misformed POST data")
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
			var query1 +=  "<expression op='equals'>" + expenseReportNames[i] + "</expression>"
			var query2 += "<expression op='equals'>" + expenseReportPeriodsEnding[i] + "</expression>"
			var query3 += "<expression op='equals'>" + expenseReportAmountsDue[i] + "</expression>"
		}
		query1 += "</field>"
		query2 += "</field>"
		query3 += "</field>"

		var query4 += "<field>SubmitterID<expression op='equals'>" + resourceID + "</expression></field>"

		query = query1 + query2 + query3 + query4
		queryStringTail = "</query></queryxml>]]></sXML></query>"
	}
	else if (mostRecentTickets != undefined)
	{
		var ticketNumbers = mostRecentTickets["ticketNumbers"]
		var ticketTimesWorked = mostRecentTickets["timesWorked"]

		if (ticketNumbers== undefined || ticketTimesWorked == undefined)
		{
			addReturnLog("error", "Misformed POST data")
			callback(undefined)
			return
		}
		if  (ticketNumbers.length == 0 || ticketTimesWorked.length == 0)
		{
			addReturnLog("error", "Misformed POST data")
			callback(undefined)
			return
		}
		if  (ticketNumbers.length != ticketTimesWorked.length)
		{
			addReturnLog("error", "Misformed POST data")
			callback(undefined)
			return
		}
		desiredResponseLength = ticketNumbers.length

		var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>Ticket</entity><query>"
		var query1 = "<field>TicketNumber"
		//var query2 = "<field>"

		for (var i = 0; i < expenseReportNames.length; i++)
		{
			var query1 +=  "<expression op='equals'>" + ticketNumbers[i] + "</expression>"
			//var query2 += "<expression op='equals'>" + expenseReportPeriodsEnding[i] + "</expression>"
			//var query3 += "<expression op='equals'>" + expenseReportAmountsDue[i] + "</expression>"
		}
		query1 += "</field>"
		query2 += "</field>"
		query3 += "</field>"

		var query4 += "<field>SubmitterID<expression op='equals'>" + resourceID + "</expression></field>"

		query = query1// + query2 + query3 + query4
		queryStringTail = "</query></queryxml>]]></sXML></query>"

	}
	else
	{
		addReturnLog("error", "No relevant travel data given to server")
		callback(undefined)
		return
	}

	sendRequest(queryStringHead + query + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var entities = getEntities(result)

			if (entities== undefined || entities.length == 0 || entities.length != desiredResponseLength)
			{
				addReturnLog("error", "It seems like you are trying to impersonate someone! This request has been logged.") // No it hasn't :)
				addReturnLog("warning", "If this is an error, and it persists, please contact <b>Jacob Fakult<b>")
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

	authenticateUserRequest : authenticateUserRequest
	
}; // Closing bracket of module exports

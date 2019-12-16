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

var contractIDToAccountIDMap = {}
var travelDistanceMap = {}
var addressToAccountIDMap = {}
var accountIDToAnnualProjectMap = {}
var annualProjectIDToTaskIDMap = {}

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

function buildTicketsQueryRequest(resourceID, callback) // Queries for a list of all tickets since "last monday"
{
	var lastMonday = new Date()
	lastMonday.setHours(0)
	lastMonday.setMinutes(0)

	lastMonday.setDate(lastMonday.getDate() - ((lastMonday.getDay() + 6) % 7)) // Sets date to last Monday. Don't ask me for a mathematical proof

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>TimeEntry</entity><query><field>StartDateTime"
	var queryBody = "<expression op='greaterthan'>" + formatDate(lastMonday) + "</expression>"
	queryBody += "</field><field>ResourceID<expression op='equals'>" + resourceID + "</expression>"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"

	//console.log("Ticket query: " + queryBody)
	sendRequest(queryStringHead + queryBody + queryStringTail, callback)
}

function buildResourceQueryRequest(resourceEmail, callback)
{
	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>Resource</entity><query><field>Email"
	var queryBody = "<expression op='equals'>" + resourceEmail + "</expression>"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"
	var temp = sendRequest(queryStringHead + queryBody + queryStringTail, callback)
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
			//return
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
			}

			callback(accountIDs)
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
			
		var accountID = accountIDs[i]

		queries += "<expression op='equals'>" + accountIDs[i] + "</expression>"
	}

	sendRequest(queryStringHead + queries + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var accounts = getEntities(result)

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
	console.log("Sending: " + action + "...")
	//console.log(soapXML)
	//if (soapXML.indexOf("29684145") >= 0) return undefined
	/*soap.createClient(url, function(err, client)
	{
		client.setSecurity(new soap.BasicAuthSecurity(privateData.API_PASSWORD, privateData.API_USERNAME)));
		client.MyFunction(args, function(err, result)
		{
			console.log(result);
		});

	});*/

	soapXML = requestHeader + soapXML + requestTail

	//callback(soapXML)

	SOAP_OPTIONS = {
		host: "webservices3.autotask.net",
		port: 443,
		method: "POST",
		path: "/atservices/1.6/atws.asmx", // To use version 1.6 change to /atservices/1.6/atws.asmx
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
	    console.error("error: " + e);
	});

	//console.log(soapXML)
	//callback(soapXML)
	request.end(soapXML.toString())	
}

function getEntities(xmlObject)
{
	//console.log("---" + JSON.stringify(xmlObject["soap:Envelope"]["soap:Body"][0].queryResponse[0].queryResult[0].EntityResults[0].Entity) + "\n\n")

	try
	{
		//console.log(xmlObject["soap:Envelope"]["soap:Body"][0].queryResponse[0].queryResult[0].EntityResults[0])
		return xmlObject["soap:Envelope"]["soap:Body"][0].queryResponse[0].queryResult[0].EntityResults[0].Entity
	}
	catch (e) { return undefined }
}

function getCreateEntities(xmlObject)
{
	//console.log("---" + JSON.stringify(xmlObject["soap:Envelope"]["soap:Body"][0].queryResponse[0].queryResult[0].EntityResults[0].Entity) + "\n\n")

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

var homeAddress = "29156 Chardon rd Willoughby Hills, Ohio"
function extrapolateTravelData(ticketsData, accountsData, callback)
{
	var travelData = []  // An array where each index has the travel data for a single day (travelData[0] is Monday's travel data, etc)

	//var lastFromAddress = homeAddress
	var lastToAddress = homeAddress
	var lastArriveTime = -1
	var lastTicketEndTime = -1
	var lastFromName = "Home"
	var lastAccountID = -1
	var currentDay = undefined

	if (ticketsData.length > 0) // Initialize the day. We want to seperate travel time by which day it occured
	{
		currentDay = new Date(ticketsData[0].StartDateTime).getDate()
	}

	//log("Map", j(contractIDToAccountIDMap))
	var travelForDay = []      // Stores the information for a single day of travelling
	var trip = {}
	for (var i = 0; i < ticketsData.length; i++)
	{
		//console.log("Ticket incoming: " + j(ticketsData[i]))
		var ticket = ticketsData[i]
		var trip = {}
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
	address = address.replaceAll(",", "")
	//console.log("Checking: " + address)
	var longestSubstringIndex = 0
	var longestSubstring = ""

	for (var i = 0; i < addresses.length; i++)
	{
		var a = addresses[i]
		a = a.replaceAll(",", "")

		//console.log("Comparing: " + a)

		var substring = longestCommonSubstring(a.toLowerCase(), address.toLowerCase())

		//console.log("subString: " + substring)

		if (substring.length > longestSubstring.length)
		{
			longestSubstring = substring
			//console.log("Found new longest: " + substring.length)
			longestSubstringIndex = i
		}
	}

	//console.log("Returning: " + longestSubstringIndex + "\n\n\n")

	return [address, addresses[longestSubstringIndex]]
}

var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December" ]
function buildUploadDataRequest(travelData, requesterID, callback)
{
	buildAddTravelTimeRequest(travelData, requesterID, function(apiResponse)
	{
		console.log("Success or failed adding travel time")


		var firstTrip = travelData[0][0]                       // There should have been an "empty check" by now
		var lastTrip = travelData[travelData.length - 1][travelData.slice(-1)[0].length -1] // Javascript magic

		//console.log("Trip dates: " + j(travelData[0][0]))

		var startMonth = months[ (new Date(firstTrip.arriveTime)).getMonth() ]  //arrive because it is the first non-home trip of the month
		var endMonth = months[ (new Date(lastTrip.leaveTime)).getMonth() ]	//leave for same reason as above

		
		var startYear = (new Date(firstTrip.arriveTime)).getFullYear()
		var endYear = (new Date(lastTrip.leaveTime)).getFullYear()

		var startDesiredName = EXPENSE_TITLE + " for " + startMonth + " " + startYear
		var endDesiredName = EXPENSE_TITLE + " for " + endMonth + " " + endYear

		buildFindExpenseReportQuery(startDesiredName, function(startExpenseReportID) {   // Technically this may cause issues for the edge case
			if (startExpenseReportID == -1)					      // Where the user creates expense reports for the entire year
			{								      // AND calls them by the exact same name as this program wants to call them
				buildCreateExpenseReportRequest(startDesiredName, firstTrip.arriveTime, requesterID, function(newStartExpenseReportID) {
					//console.log("New report: " + j(newStartExpenseReportID))
					if (startMonth != endMonth)
					{
						buildCreateExpenseReportRequest(endDesiredName, lastTrip.leaveTime, requesterID, function(endExpenseReportID) {
							// Upload data
							//callback(newStartExpenseReportID + " " + endExpenseReportID)
							buildAddExpenseItemsRequest(travelData, newStartExpenseReportID, function(apiResponse) {
								callback(apiResponse)
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
				buildCreateExpenseReport(endDesiredName, lastTrip.leaveTime, requesterID, function(endExpenseReportID) {
					// Upload data
					buildAddExpenseItemsRequest(travelData, newStartExpenseReportID, function(apiResponse) {
						callback(apiResponse)
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
				console.log("No project tasks found: " + apiResponse)
				callback([])
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
				console.log("No expense reports found (creating a new one): " + apiResponse)
				callback([])
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
				console.log("No expense reports found (creating a new one): " + apiResponse)
				callback(-1)
			}
			else
			{
				//console.log(j(reports))
				//reportID = reports[0].id[0]

				callback(result)
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
				console.log("No expense ResourceRoles found : " + apiResponse)
				callback(-1)
			}
			else
			{
				//console.log(j(reports))
				//reportID = reports[0].id[0]

				callback(result)
			}
		})
	})

}

function buildFindExpenseReportQuery(desiredName, callback)
{
	var reportID = -1

	var queryStringHead = "<query xmlns='http://autotask.net/ATWS/v1_6/'><sXML><![CDATA[<queryxml><entity>ExpenseReport</entity><query><field>name"
	var queryStringTail = "</field></query></queryxml>]]></sXML></query>"

	console.log("Desired expense report: " + desiredName)
	var query = "<expression op='equals'>" + desiredName + "</expression>"

	sendRequest(queryStringHead + query + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var reports = getEntities(result)
			if (reports == undefined || reports.length == 0)
			{
				console.log("No expense reports found (creating a new one): ")
				callback(-1)
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

	//console.log(queryStringHead + query + queryStringTail)

	sendRequest(queryStringHead + query + queryStringTail, function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var entities = getCreateEntities(result)

			if (!entities || entities.length == 0)
			{
				console.log("No expense report was created: " + apiResponse)
				callback(undefined)
			}
			else
			{
				callback(parseInt(entities[0].id[0]))
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
	for (var i = 0; i < 0; i++)//travelData.length; i++)
	{
		var day = travelData[i]
		for (var j = 0; j < 1; j++) //day.length; j++)
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
			var entities = getCreateEntities(result)

			if (entities == undefined || entities.length == 0) // This would happen if all expenses were logged
			{
				console.log("Did not create any expenses: ")// + JSON.stringify(result, null, 4))
				callback("No changes made")
			}
			else
			{
				//console.log(j(result))
				callback("Finished uploading!")
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
	console.log("Adding travel times")
	
	buildResourceRoleQuery(resourceID, function(apiResponse) {
		var entities = getEntities(apiResponse)
		var resourceIDs = []
		//console.log(apiTools.j(entities))
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
				log("Days", travelData.length)
				for (var i = 0; i < travelData.length; i++)
				{
					var day = travelData[i]
					log("Day stops", day.length)
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
							// TODO: Warn about skipping this ticket
							continue
						}
						//console.log("Trip before: " + JSON.stringify(travelData][i][j]))

						var associatedAccount = trip.toAccountID
						if (associatedAccount == -1)
							associatedAccount = trip.fromAccountID
						if (associatedAccount == -1)
						{
							// TODO: Warn that we were unable to find these accounts
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
							// TODO: Log warning
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

						//log("Trip", JSON.stringify(trip))

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


						//console.log("Trip after: " + JSON.stringify(travelData[i][j]))
					}
				}

				//log("Query", query.replaceAll("<", "\n") + "\n")
				//console.log("timeRequest: " + queryStringHead + query + queryStringTail)
				
				//return

				sendRequest(queryStringHead + query + queryStringTail, function(apiResponse) {
					xml2js(apiResponse, function(err, result) {
						var entities = getCreateEntities(result)
						if (entities == undefined || entities.length == 0)
						{
							log("No timeEntries", "returned")
							//console.log("Result: " + JSON.stringify(result, null, 4))
							callback("No response returned")
						}
						else
						{
							//console.log(j(result))
							callback(result)
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

module.exports =
{
	buildAddExpenseItemsRequest: buildAddExpenseItemsRequest,

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

	roundToNearest15 : roundToNearest15
	
}; // Closing bracket of module exports

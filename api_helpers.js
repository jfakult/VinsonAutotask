// For help: https://github.com/AutotaskDevelopment/Sample-Code/blob/master/Connection Examples/NodeJs Example.js
// API Docs: https://github.com/opendns/autotask-php/files/2789940/T_WebServicesAPIv1_6.pdf

/*
 * This script is called by api_relay_server.js. api_relay_server.js is the main node server.
 * This script just contains the more "heavy" code needed to generate and interpret API requests/responses.
 * 
 * API Notes:
 * An employee is considered a "Resource" in the API (pg. 236)
 * A school is considered an "Account" in the API (pg. 39)
 * An expense report is filed as an "ExpenseItem" in the API. An "ExpenseItem" is part of an "ExpenseReport" (pg. 140/145)
 * Travel project times are submitted as a ("Project"???) (pg. 205)
 * A "TimeEntry" is used for general or regular time (pg. 325)
*/

const https = require("https")
var soap = require("soap")
var privateData = require("./config.js")

var requestHeader = `
<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:x-si="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <soap:Header>
	  <AutotaskIntegrations xmlns="http:autotask.net/ATWS/v1.6/">
	    <IntegrationCode>` + privateData.TRACKING_IDENTIFIER + `</ImpersonateAsResourceID>
	  </AutotaskIntegrations>
	</soap:Header>
	<soap:Body>`
//`</IntegrationCode><ImpersonateAsResourceID>` + privateData.RESOURCE_ID 
var requestTail = `
	</soap:Body>
  </soap:Envelope>`

// Cleaning up inputs to deny string injection attacks
function clean(val)
{
	return val.replace(/[|&;$%@"'<>()+,]/g, "");
}

function makeParam(name, value)
{
	name = clean(name)
	value = clean(value)
	return '<param name="' + name + '">' + value + '</param>'
}

function formatDate(dateObj)
{
	return dateObj.toISOString()
}

function buildTicketsQueryRequest(callback) // Queries for a list of all tickets since "last monday"
{
	var d = new Date()
	var lastMonday = new Date()
	lastMonday.setHours(0)
	lastMonday.setMinutes(0)
	
	lastMonday.setDate(-1 * ((d.getDay() + 6) % 7)) // Sets date to last Monday. Don't ask me for a mathematical proof
	var queryStringHead = "<queryxml><entity>TimeEntry</entity><query><field>StartDateTime"
	var queryBody = "<expression op='greaterthan'>" + formatDate(lastMonday) + "</expression>"
	var queryStringTail = "</field></query></queryxml>"
	var temp = sendRequest(queryStringHead + queryBody + queryStringTail, callback)
}

function sendRequest(soapXML, callback)
{
	//console.log(callback)
	/*soap.createClient(url, function(err, client)
	{
		client.setSecurity(new soap.BasicAuthSecurity(privateData.API_PASSWORD, privateData.API_USERNAME)));
		client.MyFunction(args, function(err, result)
		{
			console.log(result);
		});

	});*/

	SOAP_OPTIONS = {
		host: "webservices3.autotask.net",
		port: 443,
		method: "POST",
		path: "/atservices/1.6/atws.asmx", // To use version 1.6 change to /atservices/1.6/atws.asmx
		// authentication headers
		headers: {
		    'Content-Type': "text/xml; charset=utf-8",
		    'Content-Length': Buffer.byteLength(soapXML),
		    'Authorization': "Basic " + new Buffer(privateData.API_USERNAME + ":" + privateData.API_PASSWORD).toString("base64"),
		    //'SOAPAction': "http://autotask.net/ATWS/v1_6/getThresholdAndUsageInfo",
		    'Accept': "application/json"
		}
	}

	request = https.request(SOAP_OPTIONS, function (res) {
		//console.log("statusCode:", res.statusCode);

		res.on("data", (d) => {
			//console.log(d.toString());
			responseData = d.toString()

			callback(responseData)
		})	
	});

	request.on("error", (e) => {
	    console.error(e);
	});

	request.end(soapXML)
}

module.exports =
{
	// List of Supported request types:
	REQ_temp : 1,    // User wants to find the client of the given name
	REQ_ExpenseReport : 2,  // User wants to submit an expense report
	REQ_TravelTime : 4,     // User wants to log travel time into a yearly project
	REQ_Tickets : 8,         // Get ticket information for the previous week

	// Dispatches the proper request building function
	buildAPIRequest : function(requestType, data, callback)
	{
		var responses = []
		if ((requestType & REQ_Tickets) == REQ_Tickets)
		{
			console.log("Sending query for this weeks tickets '" + data)
			var tickets = buildTicketsQueryRequest(data, callback)
			var travelData = extrapolateTicketTravelData(tickets, callback) // TODO

			responses.push(tickets)
		}
		if ((requestType & REQ_ExpenseReport) == REQ_ExpenseReport)
		{
			console.log("Sending request to create new expense report")
			responses.push(buildExpenseReportRequest(data, callback))
		}
		if ((requestType & REQ_TravelTime) == REQ_TravelTime)
		{
			console.log("Sending request to log new travel time")
			responses.push(buildTravelTimeRequest(data, callback))
		}

		console.log("Returned results:")
		for (var i = 0; i < responses.length; i++)
		{
			console.log((i + 1) + "/" + responses.length)
			console.log(responses[i])
		}
	},

	/*
	// Uses a binary search to find the client.
	// If multiple clients are returned, it queries a larger amount of the string
	// If no clients are returned it queries a smaller portion of the string
	// If it cannot resolve to a client it will assume a typo in the name
	// This is because of the nature of how we are parsing input
	// For example if the user enters a client as "Fred Doug", obviously nothing will return, thus we try to match a smaller portion of the string
	buildClientQueryRequest : function(client, max = client.toString().length, stepSize = max)
	{
		if (stepSize = 0) return undefined

		var queryStringHead = "<queryxml><entity>Account</entity><query><field>AccountName<expression op='equals'>"
		var queryStringTail = "</expression></field></query></queryxml>"

		var cli = client.substr(0, max)
		var returnedAccounts = sendRequest(queryStringHead + cli + queryStringTail)


		stepSize = parseInt(stepSize / 2)
		
		if (returnedAccounts.length == 1) return returnedAccounts
		else if (returnedAccounts > 1)
		{
			max += stepSize
			if (max >= client.length) return undefined // Shouldn't ever happen

			return buildClientQueryRequest(client, max, stepSize)
		}
		else if (returnedAccount == 0)
		{
			max -= stepSize
			if (max >= client.length) return undefined // Shouldn't ever happen

			return buildClientQueryRequest(client, max, stepSize)
		}
	},*/ // This function is vestigial
	
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
	buildAddExpenseReportRequest : function(reportObject, callback) // Note: Needs <create> tag surrounding the entity tag
	{
		var createString = ""

		createString += makeParam("billableToAccount", "") + "\n"
		createString += makeParam("description", "") + "\n"
		createString += makeParam("expenseCategory", "") + "\n"
		createString += makeParam("expenseDate", "") + "\n"
		createString += makeParam("expenseReportID", "") + "\n"
		createString += makeParam("haveReceipt", "") + "\n"
		createString += makeParam("id", "") + "\n"

		createString += makeParam("miles", "") + "\n"
		createString += makeParam("odometerStart", "") + "\n"
		createString += makeParam("odometerEnd", "") + "\n"

		var expenseResponse = sendRequest(createString, callback)

		//return expenseResponse
	},
	
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
	buildAddTravelTimeRequest : function(travelObject)
	{
		var createString = ""

		createString += makeParam("dateWorked", "") + "\n"
		createString += makeParam("id", "") + "\n"
		createString += makeParam("resourceID", "") + "\n"
		createString += makeParam("roleID", "") + "\n"
		createString += makeParam("type", "") + "\n"

		createString += makeParam("startDateTime", "") + "\n"
		createString += makeParam("endDateTime", "") + "\n"
		createString += makeParam("contractID", "") + "\n"
		createString += makeParam("SummaryNotes", "Travel from x to x") + "\n"
		createString += makeParam("taskID", "") + "\n"

		var travelTimeResponse = sendRequest(createString, callback)

		//return travelTimeResponse
	},

	formatDate : formatDate,

	buildTicketsQueryRequest : buildTicketsQueryRequest,

	sendRequest : sendRequest
	
}; // Closing bracket of module exports

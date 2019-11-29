const TRACKING_IDENTIFIER = ""
const RESOURCE_ID = ""
const API_USERNAME = ""
const API_PASSWORD = ""

var requestHeader = `
<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:x-si="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <soap:Header>
	  <AutotaskIntegrations xmlns="http:autotask.net/ATWS/v1.6/">
	    <IntegrationCode>` + TRACKING_IDENTIFIER + `</IntegrationCode>
		<ImpersonateAsResourceID>` + RESOURCE_ID + `</ImpersonateAsResourceID>
	  </AutotaskIntegrations>
	</soap:Header>
	<soap:Body>`
var requestTail = `
	</soap:Body>
  </soap:Envelope>`

module.exports = {

	// List of Supported request types:
	REQ_ClientQuery : 1,    // User wants to find the client of the given name
	REQ_ExpenseReport : 2,  // User wants to submit an expense report
	REQ_TravelTime : 4,     // User wants to log travel time into a yearly project

	buildAPIRequest : function(lrequestType, data)
	{
		var responses = []
		if (requestType == REQ_ClientQuery)
			responses.push(buildClientQueryRequest(data))
		if (requestType == REQ_ExpenseReport)
			responses.push(buildExpenseReportRequest(data))
		if (requestType == REQ_TravelTime)
			responses.push(buildTravelTimeRequest(data))
		
	},
	
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
	},
	
	// Uses the ExpenseItem API field
	buildAddExpenseReportRequest : function(reportObject)
	{
	},
	
	// Uses the __ API field
	buildAddTravelTimeRequest : function(travelObject)
	{
	},
	
	sendRequest : function()
	{
		$.post({
			url: "webservices3.autotask.net/atservices/1.6/atws.asmx",
			// authentication headers
			headers: {
				'Content-Type': "text/xml; charset=utf-8",
				//'Content-Length': xml.length,
				'Authorization': "Basic " + (API_USERNAME + ":" + API_PASSWORD).toString("base64"),
				'SOAPAction': "http://autotask.net/ATWS/v1_6/getThresholdAndUsageInfo",
				'Accept': "application/json"
			}
		}, function(response) {
			console.log(response)
		});
	}
	
}; // Closing bracket of module exports

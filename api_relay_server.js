/*
 * This file contains the main node server code to allow users to make API requests
 * It also allows some GET requests to javascript files, that will usually be requested from the Vinson-Autotask chrome extension
 * 	The reasoning for allowing requests to these javascript files is so that various functionalities can be updated on the server, and pushed to the client
 * 	This will keep the complexity of the chrome extension to a minimum
 * 	The other usage of GET requests (which anyone extending this script should understand) is demonstrated by the GET /ticketSearch (line 100 ish)
 * 		This function uses the *buildGenericQuery* function which allows for simplified API implementation. View it's usage below
 *
 */

// API Docs: https://ww4.autotask.net/help/Content/LinkedDOCUMENTS/WSAPI/T_WebServicesAPIv1_6.pdf

var http = require("http")
var https = require("https")
var request = require('request')
var xml2js = require("xml2js").parseString
var qs = require('querystring')            // Parse POST params

var fileSystem = require('fs')
var path = require('path')

var apiTools = require("./api_helpers.js") // Core API requesting functions lie here
var config = require("./config") // Keeps API keys and other private information

String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

// Main listener
http.createServer(function (request, nodeResponse)
{
	console.log("Request came in! " + request.method + " " + request.url + " from " + request.headers.origin)

	var origin = request.headers.origin

	// Allow cross-origin requesting so that we can send the chrome extension on the client javascript code
	if (origin && origin.match("https://ww.\.autotask.net"))
	{
		nodeResponse.setHeader("Access-Control-Allow-Origin", "https://ww3.autotask.net");
		nodeResponse.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	}

	// Allow a GET request if the target is one of the following files
	if (request.method == "GET")
	{
		// This file inserts HTML into the autotask client browser, giving access to the upload buttons
		if (request.url == "/api_response_helper.js")
		{
			var filePath = path.join(__dirname, 'api_response_helper.js');
			var stat = fileSystem.statSync(filePath);

			nodeResponse.writeHead(200, {
				'Content-Type': 'text/javascript',
				'Content-Length': stat.size
			});

			var readStream = fileSystem.createReadStream(filePath);
			// We replaced all the event handlers with a simple call to readStream.pipe()
			readStream.pipe(nodeResponse);

			return
		}
		// This file updates the expense amounts on the expense report view in the webpage
		else if (request.url == "/updateExpenseAmounts.js")
		{
			var filePath = path.join(__dirname, 'updateExpenseAmounts.js');
			var stat = fileSystem.statSync(filePath);

			nodeResponse.writeHead(200, {
				'Content-Type': 'text/javascript',
				'Content-Length': stat.size
			});

			var readStream = fileSystem.createReadStream(filePath);
			// We replaced all the event handlers with a simple call to readStream.pipe()
			readStream.pipe(nodeResponse);

			return
		}
		// This file autofills ticket information when the user is creating a new ticket
		else if (request.url == "/autotask_ticket_filler.js")
		{
			var filePath = path.join(__dirname, 'autotask_ticket_filler.js');
			var stat = fileSystem.statSync(filePath);

			nodeResponse.writeHead(200, {
				'Content-Type': 'text/javascript',
				'Content-Length': stat.size
			});

			var readStream = fileSystem.createReadStream(filePath);
			// We replaced all the event handlers with a simple call to readStream.pipe()
			readStream.pipe(nodeResponse);

			return
		}
		else if (request.url == "/ticketSearch")
		{
			apiTools.buildGenericQuery(null, "Account", ["AccountName"], [[{"op": "contains", "val": "Old Brook "}]], function(accounts) {
				if (accounts == undefined || accounts.length == 0)
				{
					nodeResponse.end("No accounts returned")
					return
				}

				//console.log(JSON.stringify(accounts, null, 4))
				var accountID = accounts[0].id[0]

				apiTools.buildGenericQuery(null, "Contract", ["AccountID"], [[{"op": "equals", "val": accountID}]], function(contracts) {
					if (contracts == undefined || contracts.length == 0)
					{
						nodeResponse.end("No contracts found for account: " + accountID)
						return
					}

					var contractID = contracts[0].id[0]

					// We are querying for tickets
					var entity = "Ticket"

					// Fields uses an AND search, so Description matches the expressions AND the ContractID matches its corresponding expressions
					var fields = ["Description", "ContractID"]

					//                       "Description contains 'IAP 205'"         "ContractID  equals contractIDVal"
					var expressions = [[{"op": "contains", "val": " 205"}], [{"op": "equals", "val": contractID}]]
					apiTools.buildGenericQuery(null, entity, fields, expressions, function(tickets) {
						if (tickets == undefined || tickets.length == 0)
						{
							nodeResponse.end("No tickets found")
							return
						}

						res = "Found " + tickets.length + " tickets!"
						for (var i = 0; i < tickets.length; i++)
						{
							var ticket = tickets[i]
	
							var ticketNumber = ticket.ticketNumber[0]._
							var ticketTitle = ticket.title[0]._
							var createDate = ticket.CreateDate[0]._
							var resolvedDate = ticket.ResolvedDateTime[0]._
							var discription = ticket.Description[0]._
	
							res += "Ticket Number: " + ticketNumber
							res += "Ticket Title: " + ticketTitle
							res += "Ticket Description: " + description
							res += "Created Date: " + createDate
							res += "Resolved Date: " + resolvedDate
	
							if (i > 0 && i < (tickets.length - 1))
								res += "\n\n"
						}
	
						nodeResponse.end(res)
					})
				})
			})
		}

		return
	}	
	else if (request.method != "POST") // Refuse any non-standard requests. Requests must either be GET or POST
	{
		nodeResponse.writeHead(403, {'Content-Type': 'text/plain'});
		nodeResponse.end("Invalid request")
		return
	}

   	nodeResponse.writeHead(200, {'Content-Type': 'text/plain'});
	console.log("\nStarting new connection")

	var body = '';
	request.on('data', function (data) {
		body += data;
		if (body.length > 1e6)
			request.connection.destroy();
	});
	
	request.on('end', function () {
		var post = qs.parse(body);
		uploadData(post, request, nodeResponse)
       	});

	console.log("Request url: " + request.url)


	// Use these functions for non-user related API requests (i.e api usage, field info queries, etc)
	
	/*apiTools.getFieldInfo("Role", null, function(apiResponse) { // Use this field to query picklist options
		//console.log(apiResponse)
		xml2js(apiResponse, function(err, result) {
			nodeResponse.end(apiTools.j(result))
		})
		//nodeResponse.end(apiTools.j(apiResponse))
	})
	return

	apiTools.getThresholdAndUsageInfo(function(apiResponse) { // Use this field to query picklist options
		//console.log(apiResponse)
		xml2js(apiResponse, function(err, result) {
			nodeResponse.end(apiTools.j(result))
		})
		//nodeResponse.end(apiTools.j(apiResponse))
	}, null)
	return*/
}).listen(8001);

/*
 * If you like callback functions, you're in luck
 * The function calls tend to look like this:
	
	apiTools.functionName(input, callback(output) {
		apiTools.nextFunctionName(output), callback(nextOutput) ...
		...
	})
 */

// This is the wrapper function that calls the functions that make requests to the API
function uploadData(postParams, request, nodeResponse)
{
	var generatingTravelTimes = false

	// Is the user submitting travel times or expense items
	if (request.url == "/generateTravelTimes") 
	{
		generatingTravelTimes = true
	}
	else if (request.url == "/generateExpenseReports")
	{
		generatingTravelTimes = false
	}
	else
	{
		nodeResponse.end("Invalid request")
		return
	}

	// Clean the post params for injection attacks and load them into an object
	for (param in postParams)
	{
		var cleanedVal = apiTools.clean(postParams[param], true)
		postParams[param] = cleanedVal
	}

	var emailAddress = postParams["emailAddress"]

	if (emailAddress == undefined || emailAddress.length <= 1)
	{
		apiTools.addReturnLog(STATUS_ERR, "Invalid email address supplied: '" + emailAddress + "'")
		sendResponse(nodeResponse)
		return
	}
	
	// Given the email sent, get the users resource ID
 	apiTools.buildResourceQueryRequest(emailAddress, function(resourceID) {
 	 	if (resourceID == undefined)
		{
			resourceID = null
			sendResponse(nodeResponse, resourceID)
			return
		}

	// Authenticate the user by verifying the information postParams against the API database information
	 apiTools.authenticateUserRequest(postParams, resourceID, function(emailAddress, homeAddress) {
		 if (emailAddress == undefined || homeAddress == undefined)
		 {
			 sendResponse(nodeResponse, resourceID)
			 return
		 }

	// The user's autheticity has been vallidated, find a list recent time entries. Format the data into an object
	  apiTools.buildTicketsQueryRequest(resourceID, generatingTravelTimes, function(tickets) {
		  if (tickets == undefined)
		  {
			  sendResponse(nodeResponse, resourceID)
			  return
		  }
 
	// Given the tickets object, do some more querying
 	   apiTools.parseTicketsInformation(tickets, resourceID, function(ticketsData) {    // ticketData is the main data structure. It is an array of time entries
		   								// As each function collects more info, it will be added here
		   if (ticketsData == undefined)
		   {
			   sendResponse(nodeResponse, resourceID)
			   return
		   }
		  
		   var contractIDs = ticketsData.map((val) => val.ContractID)
		   if (contractIDs == undefined)
		   {
			   sendResponse(nodeResponse, resourceID)
			   return
		   }

	// Now that we have ticketData (an array of time entries), collect information on all the schools associated with them. Returns school accountIDs
	    apiTools.buildContractIDsQueryRequest(contractIDs, resourceID, function(accountIDs) {
		    if (accountIDs == undefined)
		    {
			    sendResponse(nodeResponse, resourceID)
			    return
		    }

	// Now that we have the accountIDs, get data associated with them, including address, name, and a few other things
	     apiTools.buildAccountIDsQueryRequest(accountIDs, resourceID, function(accountsData) {
		     if (accountsData == undefined)
		     {
			     sendResponse(nodeResponse, resourceID)
			     return
		     }

	// This function crunches tons of information. It takes the list of time entries, and figures out how much driving time is done between the schools
	// If two consecutive time entries are logged at different school, it will extrapolate the driving time based on time entry start and end times
	      apiTools.extrapolateTravelData(ticketsData, accountsData, homeAddress, resourceID, function(travelData) {
		      if (travelData == undefined)
		      {
			      sendResponse(nodeResponse, resourceID)
			      return
		      }

		   console.log("Made it2")
	// Given the travel data, use the addresses of the schools and query google DistanceMatrixAPI to determine driving distance (and duration if needed)
	       apiTools.getDistanceData(travelData, nodeResponse, resourceID, function(travelData) {
		   console.log("Made it3")
		       if (travelData == undefined || travelData.length == 0)
		       {
			       sendResponse(nodeResponse, resourceID)
			       return
		       }

		       // Now we are done collecting data, these functions will upload the data by sending a create request to the API

		       //sendResponse(nodeResponse)  //TODO: temp lock. Uncomment these lines to stop the program from submitting data (for testing / debugging)
		       //return

		       if (generatingTravelTimes)
		       {
			       console.log("Generating travel times")

			       // Given the schools that we are going, find the ID of each school's annual project so we can add our travel times
			       apiTools.buildFindTravelProjectQuery(accountIDs, resourceID, function(projectIDs) {
	        	               if (projectIDs == undefined)
				       {
					       sendResponse(nodeResponse, resourceID)
					       return
				       }
			       
				// Find the tasks associated with those annual projects
				// Note the return value here is cached, that is why it is not passed into buildAddTravelTimeRequest
			        apiTools.buildFindTravelProjectTaskQuery(projectIDs, resourceID, function(taskIDs) {
		     	                if (taskIDs == undefined)
					{
						sendResponse(nodeResponse, resourceID)
						return
					}

				 // Send the create request to the api server given our travel data
				 apiTools.buildAddTravelTimeRequest(travelData, resourceID, function() {
					 sendResponse(nodeResponse, resourceID)
		 		 })
			        })
			       })
		       }
		       else // Generating an expense report
		       {
		 	       console.log("Generating expense Reports")

			       // A slightly more concise upload process than the travel times
			       apiTools.buildUploadDataRequest(travelData, resourceID, function() {
				       sendResponse(nodeResponse, resourceID)
			       })
		       } 
	       })
	      })
	     })
	    })
	   })
	  })
	 })
	})
}

// sendResponse will get when the program is ready to exit.
// The program has the capability to log messages at any point, and what is returned is an array of these messages
// This array will be formatted and displayed on the client side.
const STATUS_GOOD = 0
const STATUS_WARN = 1
const STATUS_ERR  = 2
const STATUS_MAP = ["Success", "Warning", "Error"]

// Differentiate between each individual resource before returning responses so that simultanious transactions to the server are opaque to the client
function sendResponse(nodeResponse, resourceID = "null")
{
	console.log("Sending response: " + resourceID + " " + apiTools.j(apiTools.returnMessage))

	nodeResponse.end(JSON.stringify(apiTools.returnMessage[resourceID], null, 4))
	
	apiTools.returnMessage[resourceID] = []
	return
}

console.log('Server running at http://127.0.0.1:8001/');

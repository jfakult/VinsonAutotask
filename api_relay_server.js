// https://ww4.autotask.net/help/Content/LinkedDOCUMENTS/WSAPI/T_WebServicesAPIv1_6.pdf

var http = require("http")
var https = require("https");
var request = require('request');
var apiTools = require("./api_helpers.js")
var xml2js = require("xml2js").parseString

var config = require("./config") // Keeps API keys and other private information

String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

http.createServer(function (request, nodeResponse)
{

	if (request.method != "POST")
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
	
	//apiTools.nodeResponse = nodeResponse
	
	
	//if (request.url == "/") return // only continue for root

	// Send the HTTP header 
	// HTTP Status: 200 : OK
	// Content Type: text/plain
	/*apiTools.buildFindTravelProjectQuery(426, function(apiResponse) {
		apiTools.buildFindTravelProjectTaskQuery(apiResponse, function(apiResponse) {
			nodeResponse.end(apiTools.j(apiResponse))
		})
	})
	return*/

	/*apiTools.buildResourceQueryRequest("jfakult@vinsonedu.com", function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			var resource = apiTools.getEntities(result)
			var resourceID = resource[0].id
			apiTools.buildResourceRoleQuery(resourceID, function(apiResponse) {
				var entities = apiTools.getEntities(apiResponse)

				var resourceIDs = []
				//console.log(apiTools.j(entities))
				for (var i = 0; i < entities.length; i++)
				{
					resourceIDs.push(entities[i].RoleID[0]._)
				}
				apiTools.buildRolesQuery(resourceIDs, function(apiResponse) {
					var entities = apiTools.getEntities(apiResponse)

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
						nodeResponse.end("You are not a Field Technician!")
					}
					else
					{
						nodeResponse.end(roleID)
					}
				})
			})
		})
	})
	return*/

	/*apiTools.getFieldInfo("Role", function(apiResponse) { // Use this field to query picklist options
		//console.log(apiResponse)
		xml2js(apiResponse, function(err, result) {
			nodeResponse.end(apiTools.j(result))
		})
		//nodeResponse.end(apiTools.j(apiResponse))
	})
	return*/

	/*
	apiTools.getThresholdAndUsageInfo(function(apiResponse) { // Use this field to query picklist options
		//console.log(apiResponse)
		xml2js(apiResponse, function(err, result) {
			nodeResponse.end(apiTools.j(result))
		})
		//nodeResponse.end(apiTools.j(apiResponse))
	})
	return*/

	/*
	 * If you like callback functions, you're in luck
	 * The function calls tend to look like this:

	apiTools.functionName(input, callback(output) {
		apiTools.nextFunctionName(output), callback(nextOutput) ...
		...
	})

	 */

	
	
	/*var ticketData = apiTools.buildAccountIDQueryRequest(445, function(apiResponse) {
		response.write(apiResponse.toString())
		response.end()
	})*/

	/*var ticketData = apiTools.buildContractIDQueryRequest(29684145, function(apiResponse) {
		response.write(apiResponse.toString())
		response.end()
	})*/

}).listen(8001);

function uploadData(postData, request, nodeResponse)
{
	var generatingTravelTimes = false

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

			
 	apiTools.buildResourceQueryRequest(emailAddress, function(resourceID) {
 	 	if (resourceID == undefined) sendResponse(nodeResponse)

	 apiTools.authenticateUserRequest(postParams, resourceID, function(emailAddress, homeAddress) {
		 if (emailAddress == undefined || homeAddress == undefined) sendResponse(nodeResponse)

	  apiTools.buildTicketsQueryRequest(resourceID, generatingTravelTimes, function(tickets) {
		  if (tickets == undefined) sendResponse(nodeResponse)
 
 	   apiTools.parseTicketsInformation(tickets, function(ticketsData) {
		   if (ticketsData == undefined) sendResponse(nodeResponse)
		  
		   var contractIDs = ticketsData.map((val) => val.ContractID)
		   if (contractIDs == undefined) sendResponse(nodeResponse)

	    apiTools.buildContractIDsQueryRequest(contractIDs, function(accountIDs) {
		    if (accountIDs == undefined) sendResponse(nodeResponse)

	     apiTools.buildAccountIDsQueryRequest(accountIDs, function(accountsData) {
		     if (accountsData == undefined) sendResponse(nodeResponse)

	      apiTools.extrapolateTravelData(ticketsData, accountsData, homeAddress, resourceID, function(travelData) {
		      if (travelData == undefined) sendResponse(nodeResponse)

	       apiTools.getDistanceData(travelData, nodeResponse, resourceID, function(travelData) {
		       if (travelData == undefined) sendResponse(nodeResponse)

		       sendResponse(nodeResponse)  //TODO: temp lock
		       return
		       if (generatingTravelTimes)
		       {
			       console.log("Generating travel times")

			       apiTools.buildFindTravelProjectQuery(accountIDs, function(projectIDs) {  // This function and the function below get all their data saved into
	        	               if (projectIDs == undefined) sendResponse(nodeResponse)          // The cache, that is why their returned values are not used
			       
			        apiTools.buildFindTravelProjectTaskQuery(projectIDs, function(taskIDs) {
		     	                if (taskIDs == undefined) sendResponse(nodeResponse)

				 apiTools.buildAddTravelTimeRequest(travelData, resourceID, function() {
					 sendResponse(nodeResponse)
		 		 })
			        })
			       })
		       }
		       else // Generating an expense report
		       {
		 	       console.log("Generating expense Reports")

			       apiTools.buildUploadDataRequest(travelData, resourceID, function() {
				       sendResponse(nodeResponse)
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

function sendResponse(nodeResponse)
{
	console.log(apiTools.returnMessage)
	nodeResponse.end(JSON.stringify(apiTools.returnMessage, null, 4))
	return
}

console.log('Server running at http://127.0.0.1:8001/');

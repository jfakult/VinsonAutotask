// https://ww4.autotask.net/help/Content/LinkedDOCUMENTS/WSAPI/T_WebServicesAPIv1_6.pdf

var http = require("http")
var https = require("https");
var request = require('request');
var apiTools = require("./api_helpers.js")
var xml2js = require("xml2js").parseString

var config = require("./config") // Keeps API keys and other private information

var accountInformation = {}
//var travelDistanceData = {}
var imperialOrMetric = "imperial"

String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

http.createServer(function (request, nodeResponse)
{
	if (request.url != "/") return // only continue for root

	// Send the HTTP header 
	// HTTP Status: 200 : OK
	// Content Type: text/plain
   	nodeResponse.writeHead(200, {'Content-Type': 'text/plain'});

	console.log("Starting new connection")

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
	
	var ticketData = apiTools.buildResourceQueryRequest("jfakult@vinsonedu.com", function(apiResponse) {
		xml2js(apiResponse, function(err, result) {
			if (result)
			{
				var resource = apiTools.getEntities(result)
				var resourceID = resource[0].id

				loadResourceTickets(nodeResponse, resourceID)
			}
		})
	})
	
	/*var ticketData = apiTools.buildAccountIDQueryRequest(445, function(apiResponse) {
		response.write(apiResponse.toString())
		response.end()
	})*/

	/*var ticketData = apiTools.buildContractIDQueryRequest(29684145, function(apiResponse) {
		response.write(apiResponse.toString())
		response.end()
	})*/

}).listen(8001);

function loadResourceTickets(nodeResponse, resourceID)
{
	var ticketData = apiTools.buildTicketsQueryRequest(resourceID, function(apiResponse)
	{
		/*for (var i = 0; resourceTickets.length; i++)
		{
			//console.log(resourceTickets)
		}*/

		xml2js(apiResponse, function(err, result) {
			if (result)
			{
				var tickets = apiTools.getEntities(result)
				
				parseTicketsInformation(nodeResponse, tickets, resourceID)

				//loadResourceTickets(nodeResponse, resourceID)
			}
		})

		//nodeResponse.write(apiResponse.toString())
		//nodeResponse.end()
	})
}

//Note: These values are actually TimeEntries from the API, not technically tickets. Just easier to understand this way I think
function parseTicketsInformation(nodeResponse, tickets, requesterID)
{
	if (tickets == undefined || tickets.length == 0)
	{
		nodeResponse.end("No tickets were returned")
		return
	}
	var ticketsData = []
	for (var i = 0; i < tickets.length; i++)
	{
		var ticket = tickets[i]

		if (ticket == undefined) continue
		
		var ticketData = {}

		ticketData.StartDateTime = ticket.StartDateTime[0]._
		ticketData.EndDateTime = ticket.EndDateTime[0]._
		ticketData.ContractID = ticket.ContractID[0]._

		if (!ticketData.StartDateTime.endsWith("Z")) ticketData.StartDateTime += "Z" //Make sure date is parsed as EST
		if (!ticketData.EndDateTime.endsWith("Z")) ticketData.EndDateTime += "Z"
		
		ticketsData.push(ticketData)
	}

	ticketsData = apiTools.sortTickets(ticketsData)

	apiTools.buildContractIDsQueryRequest(ticketsData.map((val) => val.ContractID), function(accountIDs) {
		apiTools.buildFindTravelProjectQuery(accountIDs, function(projectIDs) {
			apiTools.buildFindTravelProjectTaskQuery(projectIDs, function(taskIDs) {
				apiTools.buildAccountIDsQueryRequest(accountIDs, function(accountsData) {
					apiTools.extrapolateTravelData(ticketsData, accountsData, function(travelData) {
						//nodeResponse.end(JSON.stringify(ticketsData, null, 4) + "\n" + JSON.stringify(travelData, null, 4))
						getDistanceData(travelData, nodeResponse, requesterID)
					})
				})
			})
		})
	})
}

// Caches data in apiTools.travelDistanceMap
var homeAddress = "29156 Chardon rd Willoughby Hills, Ohio"

// Inputs distances that are already cached. returns a tuple of [the number of entries that were not found in the cache, updated travel data]
function loadCachedTravelData(travelData)
{
	//console.log("TravelMap: " + apiTools.j(apiTools.travelDistanceMap))
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

			if (apiTools.travelDistanceMap[fromID] && apiTools.travelDistanceMap[fromID][toID]) // if we have this data cached
			{
				travelData[i][j].distance = apiTools.travelDistanceMap[trip.fromAccountID][trip.toAccountID][0]
				totalCached++
			}
			else if (fromID == -1) // came from home
			{
				//console.log("Trip: " + apiTools.j(trip))
				if (apiTools.travelDistanceMap["Home"] && apiTools.travelDistanceMap["Home"][toID])
				{
					//console.log("Home map: " + apiTools.j(apiTools.travelDistanceMap["Home"]))
					travelData[i][j].distance = apiTools.travelDistanceMap["Home"][trip.toAccountID][0]
					travelData[i][j].leaveTime = new Date(new Date(trip.arriveTime) - (apiTools.travelDistanceMap["Home"][trip.toAccountID][1] * 3600 * 1000)).toISOString()
					//console.log("Time after: " + trip.leaveTime)
					totalCached++
				}
			}
			else if (toID == -1)
			{
				if (apiTools.travelDistanceMap[fromID] && apiTools.travelDistanceMap[fromID]["Home"])
				{
					travelData[i][j].distance = apiTools.travelDistanceMap[trip.fromAccountID]["Home"][0]
					travelData[i][j].arriveTime = new Date(new Date(trip.leaveTime) + (apiTools.travelDistanceMap[trip.fromAccountID]["Home"][1] * 3600 * 1000)).toISOString()
					totalCached++
				}
			}
			else
			{
				//console.log("Don't know: " + apiTools.j(trip))
			}
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

// Recurses one time in order to 
function getDistanceData(travelData, nodeResponse, requesterID, recursing = false)
{
	var cacheData = loadCachedTravelData(travelData)

	var uncachedTrips = cacheData[0]
	travelData = cacheData[1]

	// Recursive base case
	if (uncachedTrips == 0)
	{
		//nodeResponse.end(apiTools.j(travelData))

		uploadTravelData(travelData, nodeResponse, requesterID)

		return
	}

	if (recursing)
	{
		console.log("Google Maps was unable to find an address")
		nodeResponse.end("Error looking up address")
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
			if (apiTools.travelDistanceMap[fromID] && apiTools.travelDistanceMap[fromID][toID]) // if we have this data cached
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
	var addresses = originParams.concat(destParams).concat(homeAddress)

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
			parseDistanceMatrix(data, addresses, function() {
				getDistanceData(travelData, nodeResponse, requesterID, true)
			})
		})

		resp.on("error", (err) => {
			console.log("Error: " + err.message);
		})
	})
}

function parseDistanceMatrix(matrix, addresses, callback)
{
	//console.log(apiTools.j(apiTools.addressToAccountIDMap))
	data = JSON.parse(matrix)
	//console.log(matrix)

	var destinations = data.destination_addresses
	var origins = data.origin_addresses
	var distances = data.rows

	for (var o = 0; o < origins.length; o++)
	{
		var elements = distances[o].elements
		var origin = origins[o]
		for (var d = 0; d < destinations.length; d++)
		{
			var values = elements[d]
			var distanceMiles = Math.ceil(values.distance.value / 1608) // Convert meters to miles and round up
			var timeHours = Math.ceil((values.duration.value / 3600) * 4) / 4  // Convert seconds to hours and round up to the nearest 15

			//Not used currently
			var estimatedTime = values.duration.value / 3600.0 // convert seconds to hours
			estimatedTime = Math.ceil(estimatedTime * 4) / 4 // Round up to the nearest quarter hour

			var dest = destinations[d]
			var fromAddressConversion = apiTools.findAddress(dest, addresses)
			var toAddressConversion = apiTools.findAddress(origin, addresses)

			var fromID = apiTools.addressToAccountIDMap[fromAddressConversion[1]]
			var toID = apiTools.addressToAccountIDMap[toAddressConversion[1]]

			if (fromID == undefined) fromID = "Home"
			if (toID == undefined) toID = "Home"

			if (apiTools.travelDistanceMap[fromID] && apiTools.travelDistanceMap[fromID][toID]) // if we have this data cached
				continue

			if (!apiTools.travelDistanceMap[fromID])
				apiTools.travelDistanceMap[fromID] = {}
			if (!apiTools.travelDistanceMap[toID])
				apiTools.travelDistanceMap[toID] = {}

			apiTools.travelDistanceMap[fromID][toID] = [distanceMiles, timeHours]
			apiTools.travelDistanceMap[toID][fromID] = [distanceMiles, timeHours]
		}
	}

	callback()
}

function uploadTravelData(travelData, nodeResponse, requesterID)
{
	apiTools.buildUploadDataRequest(travelData, requesterID, function(response) {
		nodeResponse.end(apiTools.j(response))
	})
}


console.log('Server running at http://127.0.0.1:8001/');

var input = `
MONDAY:
Randall 125951 125968
OB 125968 125979 9:45 10
Regent. 125979. 125986  10:45 11
Fred Doug 125986 125993 1115 1145
St leo   125993 125997   1230 115
Home 126020



TUESDAY:
Lei 126028 126048 (no work)
OB 126048. 126054 8:45 9
Fred Doug 126054. 9:30 945
Lake Erie 126059.  11:30 12
Leo 12:30 1
Home 126098`

// These values are used for identifying which fuzzy data value type matches (more on fuzzy matching later)
var DATE = 1
var TIME = 2
var ODOMETER = 4
var LOCATION = 8

// These keywords are used to recognize and categorize tokens (a token is each distinct section of text on a line)
var dateKeywords = [ "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",  "S", "M", "T", "W", "R", "F", "S" ];
var timeKeywords = [ "AM", "PM", "p.m", "a.m", "p.m.", "a.m.", "oclock", "o'clock" ]
var odometerKeywords = [ "mi", "mi.", "km", "km.", "miles", "kilometers" ]
var locationKeywords = [ "st", "saint", "st." ]
var homeKeywords = ["home"]

// Determines if a string is a number (including floating point values and potentially trailing dots or other things)
function isNumeric(n)
{
	return !isNaN(parseFloat(n)) && isFinite(n);
}

// The meat of the fuzzy matching algorithm. Deterines if a word is contained within a keywords list.
// Uses Levenstein to account for typos
function contains(words, token)
{
	token = token.toLowerCase()
	for (var i = 0; i < words.length; i++)
	{
		var w = words[i].toLowerCase()
		//console.log(w)
		//console.log(w + " " + token + " " + token.replace("/\W/g", '') + " " + levenstein(w, token) + " " + levenstein(w, token.replace(/\W/g, '')))
		if (token == w) return i + 1
		if (levenstein(w, token) <= 0.3 || levenstein(w, token.replace(/\W/g, '')) <= 0.3)
		{
			if (token.length > 2)
				return i + 1 // || levenstein(w, token.replace(/\W/g, '')) <= 0.3) return true
		}
	}

	return false
}

// The following functions are not 100% correct.
// They indicate whether a token is "probably" a match for their respective categories
// In other words, a single token might qualify as multiple types of values
// This is of course intentional because of the ambiguous nature of the way humans type
// 	example. The value '100' could be an odometer entry, or a shorthanded way to write '1:00pm'.
// This algorithm is flexible in those ways to accomodate the variation different people might log their entries with
function isFuzzyDate(token)
{
	if (contains(dateKeywords, token)) return true

	// e.g 1st, 2nd, 18th
	if (token.endsWith("st") || token.endsWith("nd") || token.endsWith("rd") || token.endsWith("th") && parseInt(token) != NaN) return parseInt(token) >= 1 && parseInt(token) <= 31

	// Lookeing for the typically demarcation of a date e.g 10/17
	if (token.indexOf("-") >= 0 || token.indexOf("/") >= 0)
	{
		var dateParts = token.split(/[-/]/)
		if (dateParts.length != 2) return false
		
		var month = dateParts[0]
		var day = dateParts[1]

		if (!isNumeric(month) || !isNumeric(day)) return false

		return (parseInt(month) >= 1 && parseInt(month) <= 12) &&
		       (parseInt(day)   >= 1 && parseInt(day)   <= 31)
	}

	return isNumeric(token) && parseInt(token) >= 1 && parseInt(token) <= 31
}

function isFuzzyTime(token)
{
	//if (contains(timeKeywords, token)) return true
	
	numNumeric = parseInt(token).toString().length

	// If the amount of "numbers" in this token are too many or too few, it can't be a time
	if (numNumeric < 1 || numNumeric > 4) return false

	// Looking for the typical demarcations of a time token
	if (token.indexOf(":") >= 0)
	{
		var timeParts = token.split(":")
		//console.log(timeParts)
		if (timeParts.length != 2) return false

		var hour = parseInt(timeParts[0])
		var minute = parseInt(timeParts[1])

		if (!isNumeric(hour) || !isNumeric(minute)) return false

		return (hour >= 0 && hour < 24) && (minute >= 0 && minute < 60)
	}

	// Look for any values like am, pm, or oclock
	for (const tk of timeKeywords)
	{
		if (token.toLowerCase().endsWith(tk.toLowerCase()))
			return parseInt(token) >= 0 && parseInt(token) <= 2359
	}

	if (!isNumeric(token)) return false

	// If they entered a number like 1330 then assume they meant 13:30 (1:30 pm)
	return parseInt(token) >= 0 && parseInt(token) <= 2359  //(hour >= 0 && hour < 24)
}

function isFuzzyOdometer(token)
{
	// Removing the .0 from 100.0 makes this easier to parse
	if (token.endsWith(".0")) token = token.slice(0, -2)
	else if (token.endsWith(".")) token = token.slice(0, -1) // Remove unnecessary trailing period

	// Check to see if any non-numeric characters are in the string (such as the mi in 1000mi)
	if (parseFloat(token).toString() != token)
	{
		if (token.indexOf(parseFloat(token).toString()) == 0)
		{
			var index = parseFloat(token).toString().length

			if (token.substr(index, 2) == ".0") index += 2
			var odo1 = token.substr(0, index)
			var odo2 = token.substr(index)

			// Okay this function is recursive yes... but it shouldn't recurse more than once. This is just to split unnecessary characters off
			if (isNumeric(odo1) && !isNumeric(odo2))
			{
				return isFuzzyOdometer(odo1) && isFuzzyOdometer(odo2)
			}
			else
			{
				return false
			}
		}
		//else
		//	return false
	}

	//if (contains(odometerKeywords, token)) return true

	return isNumeric(token) && parseFloat(token) >= 0
}

// This is less strict than the other fuzzy matches. Basically returns true for any word
function isFuzzyDestination(token)
{
	if (contains(locationKeywords, token)) return true
	if (contains(timeKeywords, token)) return false
	if (contains(dateKeywords, token)) return false
	if (contains(odometerKeywords, token)) return false

	// True if there are no numbers in the token
	return isNaN(parseInt(token))
}

// A token will be passed into all fuzzy matching functions.
// The resulting value with be a number where each bit position represents the result of the corresponding fuzzy match
// This function returns true if only one fuzzy function matched it
function tokenIsUnambiguous(val)
{
	return Number.isInteger(Math.log(val)/Math.log(2))
}

// Returns true if more than one fuzzy function matched the token (false if no matches or it was unambiguous)
function tokenIsAmbiguous(val)
{
	return !tokenIsUnambiguous(val) && val != 0
}

// Checks whether a token matched with a specific fuzzy function
function tokenValueIs(val, type)
{
	return (val & type) == type
}

// Runs the token through all fuzzy functions and returns the mapped binary number
function classifyToken(token)
{
	return (isFuzzyDate(token) * DATE) | (isFuzzyTime(token) * TIME) | (isFuzzyOdometer(token) * ODOMETER) | (isFuzzyDestination(token) * LOCATION)
}

// Pretty prints the fuzzy functions that the token matched with. Mostly for debugging
function describeToken(val)
{
	buildStr = ""
	if ((val & TIME) == TIME) buildStr += "time "
	if ((val & DATE) == DATE) buildStr += "date "
	if ((val & ODOMETER) == ODOMETER) buildStr += "odometer "
	if ((val & LOCATION) == LOCATION) buildStr += "location "

	return buildStr.trim()
}

// The following formatting functions are used to convert all tokens into a single format
// This will help later when we are passing values to the Autotask API
// The type checking is less rigorous because we are trusting that the fuzzy match
function formatDate(date)
{
	var d = new Date()
	var curMonth = d.getMonth()
	var curDay = d.getDate()
	var curDayOfWeek = d.getDay() // 0 for Sunday, 1 for Monday, ..., 6 for Saturday

	// Have to run back and do some basic parsing since we don't keep track of how a date is stored.
	if (date.indexOf("/") >= 0)
	{
		var parts = date.split("/")
		var month = parseInt(parts[0])
		var day = parseInt(parts[1])

		if (curMonth > month) return ""
		if (curMonth == month && curDay > day) return ""

		d.setDate(day)
		d.setMonth(month)

		return d.getFullYear() + "-" + (d.getMonth() +1) + "-" + d.getDate()
	}
	else if (contains(dateKeywords, date))
	{
		var index =  contains(dateKeywords, date) - 1
		if (index < 24) return ""

		var dayOfWeek = (index - 24) % 7

		//console.log(dayOfWeek)

		while (d.getDay() != dayOfWeek)
		{
			d.setDate(d.getDate() - 1)
		}
		return d.getFullYear() + "-" + (d.getMonth() +1) + "-" + d.getDate()
	}
}

function formatTime(time)
{
	time = time.toLowerCase()
	
	time.replace(".", "")
	var amPM = ""
	var hour = 0
	var minute = 0

	// Parse and determine the hour and minute values through a few various means
	if (time.endsWith("am") || time.endsWith("pm"))
	{
		var amPM = time.substr(time.length - 2)
	}

	if (time.indexOf(":") >= 0)
	{
		var parts = time.split(":")
		hour = parseInt(parts[0])
		minute = parseInt(parts[1])
	}
	else
	{
		time = parseInt(time)
		if (time >= 1000)
		{
			hour = time.toString().substr(0, 2)
			minute = time.toString().substr(2)
		}
		else if (time < 24)
		{
			hour = time
			minute = 0
		}
		else if (time >= 100)
		{
			hour = Math.floor(time / 100)
			minute = (time % 100)
		}
	}

	// Converting to a time value to represent time on a linear number scale
	var timeValue = hour + (minute / 60.0) // 6:30 = 6.5
	if (!amPM)
	{
		// Logged time is earlier than 6:30, we will assume it is PM (if not explicitly defined)
		// In other words, a time logged for 6:20 will be logged as 6:20pm and 6:35 will be 6:35am
		if (timeValue < 6.5 || timeValue >= 12) 
			amPM = "pm"
		else
			amPM = "am"
	}

	if (minute < 10) minute = "0" + minute
	amPM = amPM.toUpperCase()
	// Kept the amPM implementation in here because it looked nice when formatting.
	// Needed to switch to 24-hour time to help with the HTML table formatting
	if (amPM == "PM" && hour < 12) hour = parseInt(hour) + 12

	if (hour < 10) hour = "0" + hour
	
	return hour + ":" + minute
	//return hour + ":" + minute + " " + amPM
}

function formatDestination(loc)
{
	l = loc.toLowerCase()

	// All of our clients on Autotask uses saint instead of st. So expand these if not already done
	if (l.startsWith("st"))
	{
		var word = l.split(/[. ]/g)[0]
		loc = "Saint " + loc.substr(word.length + 1)
	}

	loc = loc.replace("  ", " ")

	return loc.trim()
}

// Vestigial, replaced by formatTime
function parseTime(val)
{
	return val
}

// Displays the trip object as a list of booleans, true if the value is set, false otherwise
function getElementPositions(trip)
{
	var map = [0, 0, 0, 0, 0, 0]

	if (trip["Date"]) map[0] = 1
	if (trip["Destination"]) map[1] = 1
	if (trip["StartOdometer"]) map[2] = 1
	if (trip["EndOdometer"]) map[3] = 1
	if (trip["StartTime"]) map[4] = 1
	if (trip["EndTime"]) map[5] = 1

	return map
}

// Save the token into the object that contains the data for a single drive.
// The purpose of this function is to insert data in the correct order so that incomplete travel logs will still be workable
function saveData(data, classification, token)
{
	// These lines will check what values are already logged on this drive and insert entries accordingly
	if (classification == DATE)
	{
		data["Date"] += token
	}
	else if (classification == TIME)
	{
		if (data["StartTime"] == "")
			data["StartTime"] += token
		else if (data["EndTime"] == "")
			data["EndTime"] += token
	}
	else if (classification == ODOMETER)
	{
		if (data["EndOdometer"] == "")
			data["EndOdometer"] += token
		else if (data["StartOdometer"] == "")
		{
			if (parseInt(token) > parseInt(data["EndOdometer"]))
			{
				data["StartOdometer"] = data["EndOdometer"]
				data["EndOdometer"] = token
			}
			else
				data["StartOdometer"] += token
		}
	}
	else if (classification == LOCATION)
	{
		data["Destination"] += token + " "
	}
	else if (classification == (DATE | TIME))
	{
		data["DateOrTimeIsAmbiguous"] = true
		if (data["StartTime"] == "")
			data["StartTime"] += token
		else if (data["EndTime"] == "")
			data["EndTime"] += token
		else if (data["StartOdometer"] == "")
			data["StartOdometer"] += token
		else if (data["EndOdometer"] == "")
			data["EndOdometer"] += token

	}
}

// Takes the full drive data and passes each bit into their respective formatting functions
// We do this before passing it into the full travel data structure
function formatData(tripData)
{
	if (tripData["Date"])
	{
		tripData["Date"] = formatDate(tripData["Date"])
	}
	if (tripData["Source"])
	{
		tripData["Source"] = formatDestination(tripData["Source"])
	}
	if (tripData["Destination"])
	{
		tripData["Destination"] = formatDestination(tripData["Destination"])
	}

	if (tripData["StartTime"])
	{
		tripData["StartTime"] = formatTime(tripData["StartTime"])
	}
	if (tripData["EndTime"])
	{
		tripData["EndTime"] = formatTime(tripData["EndTime"])
	}
	if (tripData["StartOdometer"])
	{
		tripData["StartOdomoter"] = parseFloat(tripData["StartOdometer"])
	}
	if (tripData["EndOdometer"])
	{
		tripData["EndOdometer"] = parseFloat(tripData["EndOdometer"])
	}
	
	return tripData
}

// This function is used after the trip table has been built.
// When a user edits anything in the table this function is called to reflect those changes in our data structure a-la React.js
function updateTableDataMap(cell)
{
	var data = cell.getAttribute("data-location").split("-")
	var index = parseInt(data[0])
	var valueType = data[1]

	//console.log(index + " " + valueType + " " + travelData["trips"][index][valueType] + " " + cell.innerHTML)

	travelData["trips"][index][valueType] = cell.innerHTML
}

// The meat of the parsing code. Takes a single line, splits it into tokens, classifies them, and places them in the trip data structure
function splitLine(line)
{
	if (line.endsWith(":")) line = line.slice(0, -1) // For entries that look like: 'Monday:'
	var tokens = line.split(" ") // Each token is delimited by a space
	
	var classification = []
	var tripData = {
		"Source": "",        // To be filled in once more drives are logged
		"Destination": "",
		"Date": "",
		"StartOdometer": "",
		"EndOdometer": "",
		"StartTime": "",
		"EndTime": "",
		"DateOrTimeIsAmbiguous": false // There may be some cases where we want to look into fixing ambiguity. Only checking the most straightforward edge cases currently
	}

	//var token = "" // Vestigial
	var lastTokenType = 0
	for (var i = 0; i < tokens.length; i++)
	{
		var token = tokens[i]
		
		// Turn the token into the binary represntation
		var classification = classifyToken(token)
		//console.log(token, describeToken(classification))
		
		// Try to quickly resolve any simple conflict ambiguity
		// Check for various common causes of ambiguity and handle it based on extra parsing or previous classifications
		if (tokenIsAmbiguous(classification))
		{
			if (lastTokenType == DATE) classification = DATE     // i.e The last token was 'August' and this token is '3rd'
			if (classification.length < 3) classification = DATE // Honestly no idea what I was writing here... leaving it in though

			// Check for ambiguity between a time and odometer. Use basic checking to categorize it
			if (tokenValueIs( classification, (TIME | ODOMETER) ))
			{
				if (parseInt(token) >= 2360) classification = ODOMETER
				//if (token.length == 2)
				else classification = TIME
			}
		}

		if (classification == 0)
		{
			// Do something? Ignore?
		}

		//if (isUnambiguous(classification))
		//{
		// See function description
		saveData(tripData, classification, token)
		//}

		// Used for fixing ambiguous situations
		lastTokenType = classification
	}
	
	//console.log(tokens)
	//console.log(tripData)
	return tripData
}

// Main data parsing function. Calls parseLine
// Returns an object with completely filled, classified, and formatted trip data
function parseInput(input)
{
	var data = { "trips": [] }
	var lines = input.split("\n")

	var currentDate = ""
	var previousDestination = "Home"
	var previousOdometer = 0

	// Loop through every line and classify it
	for (var i = 0; i < lines.length; i++)
	{
		var line = lines[i]

		if (!line) continue
		//console.log(i)

		var tripData = splitLine(line)

		// Update a few flags to help us keep a sense of time in our parsing. This will help us classify data more accurately
		// This is also where we add the "Source" value to our data object
		if (tripData["Date"])
		{
			currentDate = tripData["Date"]
		}
		else
		{
			tripData["Date"] = currentDate
		}
		if (previousDestination)
		{
			tripData["Source"] = previousDestination
		}
		if (!tripData["Destination"])
		{
			// Check for the possibilitp that they didn't write in "home" but just the values
			if (tripData["EndOdometer"] || tripData["StartTime"])
			{
				tripData["Destination"] = "Home"
				previousOdometer = 0
			}
			else
				continue
		}
		else
		{
			previousDestination = tripData["Destination"]
		}
		if (tripData["StartTime"])
		{
			tripData["StartTime"] = parseTime(tripData["StartTime"])
		}
		if (tripData["EndTime"])
		{
			tripData["EndTime"] = parseTime(tripData["EndTime"])
		}
		if (tripData["StartOdometer"])
		{
			tripData["StartOdometer"] = parseFloat(tripData["StartOdometer"])
		}
		if (tripData["EndOdometer"])
		{
			tripData["EndOdometer"] = parseFloat(tripData["EndOdometer"])

			if (!tripData["StartOdometer"])
			{
				if (previousOdometer > 0)
					tripData["StartOdometer"] = previousOdometer
			}

			previousOdometer = tripData["EndOdometer"]
		}
		else
		{
			previousOdometer = 0
		}
		if (tripData["DateOrTimeIsAmbiguous"])
		{
			// Ignore for now
		}

		if (contains(homeKeywords, tripData["Destination"]))
		{
			previousDestination = "Home"
			previousOdometer = 0
		}

		//var fillMap = getElementPositions(tripData)
	
		//if (!fillMap[1]) continue // There is no Destination

		tripData = formatData(tripData)

		data["trips"].push(tripData)

	}

	return data
}

// Store all data in a global variable.
// Need to do this so that we can update it if a user wants to edit a value in the output table
var travelData = parseInput(input)

var tripValues = ["Date", "Source", "Destination", "StartOdometer", "EndOdometer", "StartTime", "EndTime"]//, "Time", "Distance"]
//var travelData = {}

// Go through all the travel data we have created and build an HTML table to display it.
// Allow the user to edit the values before they submit it
function populateTable()
{
	// Get a reference to the table (already exists, inserted by a userscript likely) and empty it
	var table = document.getElementById("travelTable")
	table.innerHTML = table.children[0].outerHTML

	//console.log(travelData)
	// Go through the data one drive at a time
	for (var i = 0; i < travelData["trips"].length; i++)
	{
		var trip = travelData["trips"][i]

		//console.log(trip)

		// Create the HTML elements and build them up as necessary
		var row = document.createElement("tr")
		row.classList.add("tripData")

		for (var j = 0; j < tripValues.length; j++)
		{
			var val = tripValues[j]

			var c = document.createElement("td")

			var cell = document.createElement("input")
			if (val == "Date") cell.type = "date"
			if (val == "StartOdometer" || val == "EndOdometer") cell.type = "number"
			if (val == "StartTime" || val == "EndTime") cell.type = "time"

			cell.value =  trip[val]
			//cell.contentEditable = true
			cell.setAttribute("data-location", i + "-" + val)

			// Add a listener to keep the data structure updated when a user edits a value
			cell.onchange = function() { updateTableDataMap(this) }

			c.appendChild(cell)
			row.appendChild(c)
		}

		table.appendChild(row)

		//console.log(trip)
	}
}

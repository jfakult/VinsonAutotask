insertAutomationHTML()

const STATUS_GOOD = 0
const STATUS_WARN = 1
const STATUS_ERR  = 2
const STATUS_MAP = ["Success", "Warning", "Error"]

Element.prototype.appendAfter = function (element) {
	element.parentNode.insertBefore(this, element.nextSibling)
}

Element.prototype.remove = function() {
    this.parentElement.removeChild(this);
}

var autoGenerateButton = undefined
var mode = ""

function insertAutomationHTML()
{
	if (window.top === window.self) return // Only continue if we are loading an iframe

	if (window.location.href.indexOf("expenseReports") >= 0)
	{
		insertExpenseReportHTML()
	}
	else if (window.location.href.indexOf("wrkEntry") >= 0)  // Whitelist any other urls here
	{
		insertTimesheetHTML()
	}
}

function insertTimesheetHTML()
{
	var form = document.getElementById("form1")

	if (form == undefined || form == null)
		return

	var buttonBar = form.parentElement

	var autoGenerateButton = '<a id="autoGenerateButton" class="ImgLink" href="#" title="Upload Report">Auto Generate Travel Times</a>'

	buttonBar.insertAdjacentHTML("afterbegin", autoGenerateButton)
	autoGenerateButton = document.getElementById("autoGenerateButton")
	$(autoGenerateButton).css({
		border: "1px solid #bcbcbc",
		display: "inline-block",
		color: "#4F4F4F",
		cursor: "pointer",
		padding: "0 5px 0 3px",
		position: "relative",
		textDecoration: "none",
		verticalAlign: "middle",
		height: "24px",
		fontSize: "12px",
		fontWeight: "bold",
		lineHeight: "26px",
		padding: "0 5px 0 5px",
		verticalAlign: "top",
		background: "linear-gradient(to bottom,#fff 0,#d7d7d7 100%)",
		marginLeft: "10px",
		marginBottom: "10px"
	})
	
	var updateInfoButton = document.getElementById("autoGenerateButton").cloneNode(true)
	updateInfoButton.innerHTML = "Update user information"
	updateInfoButton.setAttribute("id", "updateInfoButton")
	autoGenerateButton.insertAdjacentHTML("afterend", updateInfoButton.outerHTML)

	document.getElementById("autoGenerateButton").onclick = autoGenerateTravelTimes
	document.getElementById("updateInfoButton").onclick = updateUserInfo
}

function insertExpenseReportHTML()
{
	var form = document.getElementById("form1")

	if (form == undefined)
		return

	var buttonBar = form.getElementsByClassName("ButtonBar")[0]

	if (buttonBar == undefined)
		return

	var autoGenerateButton = '<li><a id="autoGenerateButton" class="ImgLink" href="#" title="Upload Report">Auto Generate Expense Report</a></li>'

	buttonBar.children[0].insertAdjacentHTML("beforeend", autoGenerateButton)
	autoGenerateButton = document.getElementById("autoGenerateButton")
	$(autoGenerateButton).css({
		border: "1px solid #bcbcbc",
		display: "inline-block",
		color: "#4F4F4F",
		cursor: "pointer",
		padding: "0 5px 0 3px",
		position: "relative",
		textDecoration: "none",
		verticalAlign: "middle",
		height: "24px",
		fontSize: "12px",
		fontWeight: "bold",
		lineHeight: "26px",
		padding: "0 5px 0 5px",
		verticalAlign: "top",
		background: "linear-gradient(to bottom,#fff 0,#d7d7d7 100%)",
		marginLeft: "10px",
		marginBottom: "10px"
	})

	var updateInfoButton = document.getElementById("autoGenerateButton").cloneNode(true)
	updateInfoButton.innerHTML = "Update user information"
	updateInfoButton.setAttribute("id", "updateInfoButton")
	buttonBar.children[0].insertAdjacentHTML("beforeend", updateInfoButton.outerHTML)

	document.getElementById("autoGenerateButton").onclick = autoGenerateExpenseReport
	document.getElementById("updateInfoButton").onclick = updateUserInfo
}

function updateUserInfo()
{
	var email = ""
	var homeAddress = ""
	var rewriteData = "false"
	var apiData = {}
	if (localStorage.API)
	{
		apiData = JSON.parse(localStorage.API)

		email = apiData.emailAddress
		homeAddress = apiData.homeAddress
		rewriteData = apiData.rewriteData
	}
	else
	{
		localStorage.API = "{}"
	}

	email = prompt("Please enter your email address", email)

	while (email.length < 2)
	{
		email = prompt("Please enter a valid email address", email)
		if (email == null)
			break
	}
	if (email != null)
		apiData["emailAddress"] = email

	homeAddress = prompt("Please enter your home address", homeAddress)
	while (homeAddress.length < 2)
	{
		homeAddress = prompt("Please enter a valid home address", homeAddress)
		if (homeAddress == null)
			break
	}
	if (homeAddress != null)
		apiData["homeAddress"] = homeAddress

	apiData["rewriteData"] = rewriteData

	localStorage.API = JSON.stringify(apiData)
}

function autoGenerateExpenseReport()
{
	var sibling = document.getElementById("expenseGrid")
	var apiData = JSON.parse(localStorage.API)

	var intervalKill = showLoadingSplash()
	$.ajax({
		url: "http://127.0.0.1:8001/generateExpenseReports",
		//url: "http://10.180.8.116:8001/generateExpenseReports",

		type: "post",
		data: "emailAddress=" + apiData.emailAddress + "&homeAddress=" + apiData.homeAddress + "&rewriteData=" + apiData.rewriteData,
		//url: "http://127.0.0.1:8001/generateExpenseReports",
		success: function(response)
		{
			clearInterval(intervalKill)
			var splashBox = document.getElementById("splashBox")
			$(splashBox).animate({
				opacity: "0"
			}, 800)
			setTimeout(function() {
				splashBox.remove()
				showResultMessage(response, sibling, function(resultContainer, sibling, val) {
					$(sibling).css({
						background: "white",
						transition: "top 1s",
					})
					$(sibling).css({
						top: val + "px"
					})
				})
			}, 800)
	
			//location.reload()
		},
		error: function(err)
		{
			console.log("Got error: " + JSON.stringify(err))
		}
	})
}

function autoGenerateTravelTimes()
{
	var button = document.getElementById("autoGenerateButton")
	var sibling = document.getElementById("divTableContainer")
	
	var apiData = JSON.parse(localStorage.API)

	var intervalKill = showLoadingSplash()
	$.ajax({
		url: "http://127.0.0.1:8001/generateTravelTimes",
		type: "post",
		data: "emailAddress=" + apiData.emailAddress + "&homeAddress=" + apiData.homeAddress + "&rewriteData=" + apiData.rewriteData,
		success: function(response)
		{
			clearInterval(intervalKill)
			var splashBox = document.getElementById("splashBox")
			$(splashBox).animate({
				opacity: "0"
			}, 800)
			setTimeout(function() {
				splashBox.parentElement.remove(splashBox)

				showResultMessage(response, sibling, function(resultContainer, sibling, val) {
					var button = document.getElementById("autoGenerateButton")
					$(sibling).css({
						background: "white",
						transition: "top 1s",
						top: val + "px"
					})
				}, "relative")
			}, 800)

			//location.reload()
			console.log("Got response: " + response)
		},
		error: function(err)
		{
			console.log("Got error: " + JSON.stringify(err))
		}
	})
}

var splashImages = [""]
var splashMessages = [ "Sending Authentication Information...", "Querying user tickets...", "Extrapolating Travel Data...", "Getting Google Directions API travel data...", "Uploading results..." ]
function showLoadingSplash()
{
	var splashBox = document.getElementById("splashBox")

	if (splashBox == undefined)
		splashBox = document.createElement("div")

	splashBox.innerHTML = ""
	splashBox.setAttribute("id", "splashBox")
	$(splashBox).css({
		position: "fixed",
		textAlign: "center",
		width: "400px",
		marginLeft: "calc(50% - 200px)",
		height: "150px",
		background: "white",
		zIndex: "100",
		border: "1px solid grey"
	})
	var infoBox = document.createElement("div")
	infoBox.setAttribute("id", "splashInfoBox")
	$(infoBox).css({
		textAlign: "center",
		padding: "16px",
		paddingTop: "48px",
		fontSize: "24px",
		opacity: 0
	})

	splashBox.appendChild(infoBox)
	document.body.appendChild(splashBox)

	var splashMessageIndex = 0
	infoBox.innerHTML = splashMessages[splashMessageIndex]
	$(infoBox).animate({
		opacity: "1"
	}, 600)

	splashMessageIndex++

	var splashKill = setInterval(function incrementSplash() {
		if (splashMessageIndex < splashMessages.length)
		{
			$(infoBox).animate({
				opacity: "0"
			}, 200)
			setTimeout(function() {
				infoBox.innerHTML = splashMessages[splashMessageIndex]
				splashMessageIndex++

				$(infoBox).animate({
					opacity: "1"
				}, 600)

				return incrementSplash
			}, 800)
		}
		else
		{
			clearInterval(splashKill)
		}
	}, 2300)  // Parenths here run the function through with no delay (setInterval one interval waits before running)

	return splashKill
}

function showResultMessage(response, messageSibling, moveElement, elementPosition)
{
	//console.log("response: " + response)
	if (response == undefined || response.length == 0)
		response = '[{"status": 2, "message": "No response returned"}]'

	console.log("response: " + response)

	var currentTop = parseInt(getComputedStyle(messageSibling).top)
	if (isNaN(currentTop))
		currentTop = 0

	$(messageSibling).css({
		top: currentTop + "px",
	})

	if (elementPosition != undefined)
	{
		$(messageSibling).css({
			position: elementPosition
		})
	}

	var resultContainer = document.getElementById("apiResultContainer")
	if (resultContainer == undefined)
	{
		resultContainer = document.createElement("div")
	}
	else
	{
		currentTop -= $(resultContainer).outerHeight()
		resultContainer.innerHTML = ""
	}

	resultContainer.setAttribute("style", "padding: 8px")
	resultContainer.setAttribute("id", "apiResultContainer")

	var resultList = document.createElement("ul")
	var resultHeader = document.createElement("span")
	resultHeader.innerHTML = "Server Response"
	resultHeader.setAttribute("style", "font-size: 125%")

	resultList.appendChild(resultHeader)

	var responseValues = JSON.parse(response)
	for (var i = 0; i < responseValues.length; i++)
	{
		var message = responseValues[i]
		var messageStatus = message.status
		var messageText = message.message

		if (!messageText || messageText.length == 0)
			messageText = "No value returned"

		var resultListItem = document.createElement("li")

		var listItemStyle = ""
		if (messageStatus == STATUS_GOOD)
			listItemStyle = "color: green"
		else if (messageStatus == STATUS_WARN)
			listItemStyle = "color: orange"
		else if (messageStatus == STATUS_ERR)
			listItemStyle = "color: red"

		resultListItem.innerHTML = STATUS_MAP[messageStatus] + ": " + messageText
		resultListItem.setAttribute("style", listItemStyle)

		resultList.appendChild(resultListItem)
	}
	resultContainer.appendChild(resultList)
	$(resultContainer).css({
		position: "absolute",
		zIndex: "1"
	})

	messageSibling.parentElement.insertBefore(resultContainer, messageSibling)

	$(messageSibling).css({
		zIndex: "2"
	})

	var resultContainerHeight = $(resultContainer).outerHeight()

	moveElement(resultContainer, messageSibling, currentTop + resultContainerHeight)
}

// ==UserScript==
// @name         New Userscript
// @version      0.1
// @description  try to take over the world!
// @author       You
// @include      https://*autotask*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    if (window.top === window.self) return // Only continue if it is an iframe

    var headers = document.getElementsByClassName("HeaderRow")
    if (!headers || headers.length == 0) { return; }

    var header = headers[0]
    var subHeader = header.getElementsByClassName("SecondaryTitle")
    if (!subHeader || subHeader.length == 0) { return; }

    var subTitle = subHeader[0].textContent.trim()
    var content = header.textContent.trim()
    var title = content.substr(0, content.indexOf(subTitle)).trim() // Take the "difference" of the whole content string and the subtitle, leaving the title itself

    subTitle = subTitle.substr(subTitle.indexOf("- ") + 1).trim() // Get rid of a leading dash if it exists

    function uploadExpenseReport()
    {

    }

    var buttons = document.getElementsByClassName("ButtonBar")[0].children[0]
    var uploadButtonWrapper = `
<li id="customUploadButton">
<a class="ImgLink" href="#" title="Upload Report"><span class="Text">Upload Report</span></a>
<span style="margin-left:3px; margin-right:3px;"></span>
<span></span></li>
`
    buttons.insertAdjacentHTML("beforeend", uploadButtonWrapper)
    document.getElementById("customUploadButton").onClick = uploadExpenseReport
})();
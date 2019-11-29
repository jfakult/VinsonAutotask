#Vinson Autotask API Tools

##What will you find here
This repository holds a few tools used to implement the Autotask API.
Their basic purpose is to take a field technician's travel logs and use the API to input the data automatically.

##List of files
for more information see in-file comments

###api_relay_server.js
This is a node server that listens for API requests and directs them properly. It will only send thhe API request if the requester has permission to do so.
This script contains the administrator credentials for the API user, and thus should only be accessible by an employee with access to it.
Any employee can send a request here, but this script will determine whether they have permission to relay that request to the API

###api_helpers.js
This script is imported by the api_relay_server.
It contains the necessary logic to format and interpret requests, then redirect them to the Autotask API

###expenseReport.user.js
This is a proof-of-concept script. The end purpose is that it will modify the autotask HTML to add the interface for uploading travel logs

###index.html, index.css, index.js
These files contain the core data parsing code.
index.js takes an input, interprets the data, then formats it onto an HTML table (that shows up in index.html)
Currently you have to open *Inspect Element* and run the populateTable() function to start it.

###levenstein.js
Code taken from a stackoverflow page
Basically an algorithm to determine how *similar* 2 words are to each other.
Used by index.js for input parsing

## How to use
###Disclaimer:
        These script are still in the "rough draft" stage, so they aren't too user friendly

###Linux
* Clone the repository
* cd into the directory
Running the travel data input:
        ```python
        python -m SimpleHTTPServer
        ```
        or
        ```python
        python2 -m SimpleHTTPServer
        ```
Running the api relay server:
        ```bash
        node install
	node api_relay_server.js
        ```

@echo off
REM Launches a normal Chrome (no automation flags) with a debug port open.
REM Log into Gemini in this window, then run: node scrape.js
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
%CHROME% --remote-debugging-port=9222 --user-data-dir="%~dp0chrome-cdp-profile" https://gemini.google.com/app

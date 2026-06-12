window.AutoLockAuth = (function () {
  'use strict';
  var STORAGE_KEY = 'lc_auth', LOCKOUT_KEY = 'lc_lockout', ATTEMPTS_KEY = 'lc_attempts', CSRF_KEY = 'lc_csrf';
  var MAX_LOGIN_ATTEMPTS = 5, LOCKOUT_MS = 5 * 60 * 1000;
  function generateToken(len) {
    var arr = new Uint8Array(len || 32); crypto.getRandomValues(arr);
    return Array.from(arr).map(function(b){return b.toString(16).padStart(2,'0');}).join('').slice(0,len||32);
  }
  function getCsrfToken() { var t=sessionStorage.getItem(CSRF_KEY); if(!t){t=generateToken(32);sessionStorage.setItem(CSRF_KEY,t);} return t; }
  function isAuthenticated() { try { var d=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'); return !!(d&&d.token); } catch(e){return false;} }
  function login(u,t) { localStorage.setItem(STORAGE_KEY,JSON.stringify({username:u,token:t,ts:Date.now()})); localStorage.removeItem(ATTEMPTS_KEY); localStorage.removeItem(LOCKOUT_KEY); }
  function logout() { localStorage.removeItem(STORAGE_KEY); }
  function getAttempts() { return parseInt(localStorage.getItem(ATTEMPTS_KEY)||'0',10); }
  function isLockedOut() { var u=parseInt(localStorage.getItem(LOCKOUT_KEY)||'0',10); if(!u)return false; if(Date.now()<u)return true; localStorage.removeItem(LOCKOUT_KEY); localStorage.removeItem(ATTEMPTS_KEY); return false; }
  function lockoutRemainingMs() { return Math.max(0,parseInt(localStorage.getItem(LOCKOUT_KEY)||'0',10)-Date.now()); }
  function recordFailedAttempt() { var a=getAttempts()+1; localStorage.setItem(ATTEMPTS_KEY,a); if(a>=MAX_LOGIN_ATTEMPTS){localStorage.setItem(LOCKOUT_KEY,Date.now()+LOCKOUT_MS);return{locked:true,remaining:0};} return{locked:false,remaining:MAX_LOGIN_ATTEMPTS-a}; }
  function validateUsername(u) { return typeof u==='string'&&u.length>=1&&/^[a-zA-Z0-9@._\-]+$/.test(u); }
  function validatePassword(p) { return typeof p==='string'&&p.length>=6; }
  function getUsername() { try { var d=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'); return (d&&d.username)||null; } catch(e){return null;} }
  return { MAX_LOGIN_ATTEMPTS:MAX_LOGIN_ATTEMPTS, generateToken:generateToken, getCsrfToken:getCsrfToken, isAuthenticated:isAuthenticated, login:login, logout:logout, getAttempts:getAttempts, isLockedOut:isLockedOut, lockoutRemainingMs:lockoutRemainingMs, recordFailedAttempt:recordFailedAttempt, validateUsername:validateUsername, validatePassword:validatePassword, getUsername:getUsername };
})();

var MSAL_CONFIG = { auth: { clientId:'8ff5d22d-7162-4d48-8945-3a5ad12d443e', authority:'https://login.microsoftonline.com/e233a862-660a-4a27-83ac-9c1a68300103', redirectUri:window.location.origin+'/login.html' }, cache:{cacheLocation:'sessionStorage',storeAuthStateInCookie:false} };
var MSAL_LOGIN_SCOPES = ['openid','profile','email','User.Read'];
var _msalInstance = null;
function _getMsalInstance() { if(_msalInstance)return _msalInstance; if(typeof msal==='undefined'){console.error('[MSAL] not loaded');return null;} _msalInstance=new msal.PublicClientApplication(MSAL_CONFIG); _msalInstance.handleRedirectPromise().then(function(r){if(r&&r.account)_onMsalSuccess(r);}).catch(function(e){console.error('[MSAL]',e);}); return _msalInstance; }
function _onMsalSuccess(r) { var a=r.account; window.AutoLockAuth.login(a.username||a.name||'ms-agent','msal-'+(r.idToken||r.accessToken||a.homeAccountId)); window.location.href='agent-dashboard-autolock.html'; }
function _msalBannerError(msg) { var b=document.getElementById('banner-error'); if(b){b.textContent=msg;b.classList.add('show');} }
function msalSignIn() { var i=_getMsalInstance(); if(!i){_msalBannerError('MSAL kunne ikke indlæses.');return;} var btn=document.getElementById('ms-login-btn'); if(btn){btn.disabled=true;btn.querySelector('.btn-text').textContent='Venter…';} i.loginPopup({scopes:MSAL_LOGIN_SCOPES}).then(_onMsalSuccess).catch(function(e){console.error(e);if(e.errorCode==='popup_window_error')i.loginRedirect({scopes:MSAL_LOGIN_SCOPES});else{if(btn){btn.disabled=false;btn.querySelector('.btn-text').textContent='Sign in with Microsoft';}if(e.errorCode!=='user_cancelled')_msalBannerError('Fejl: '+(e.errorMessage||e.message));}}); }
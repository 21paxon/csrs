
"use strict";

// The public landing page does not require an admin login.
// Do not redirect visitors based on sessionStorage.
// Do not provide sign-out functionality on this page.

document.addEventListener("DOMContentLoaded", () => {
  const yearElement = document.getElementById("currentYear");

  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }
});

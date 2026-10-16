"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const yearElement = document.getElementById("currentYear");

  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  // Highlight the header link for the section currently on screen
  const navLinks = document.querySelectorAll(".nav-links > a");
  const homeLink = document.querySelector('.nav-links > a[href="/home.html"]');
  const sectionIds = ["services", "about"];

  function setActive(activeLink) {
    navLinks.forEach(link => {
      if (link.classList.contains("login-btn") ||
          link.classList.contains("nav-signin")) {
        return;
      }

      const isActive = link === activeLink;
      link.classList.toggle("active", isActive);

      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  if ("IntersectionObserver" in window) {
    const visible = {};

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        visible[entry.target.id] = entry.isIntersecting;
      });

      const current = sectionIds.find(id => visible[id]);
      const link = current
        ? document.querySelector('.nav-links > a[href="#' + current + '"]')
        : homeLink;

      if (link) setActive(link);
    }, { rootMargin: "-25% 0px -55% 0px" });

    sectionIds.forEach(id => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });
  }
});
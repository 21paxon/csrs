"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const yearElement = document.getElementById("currentYear");

  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  const token = sessionStorage.getItem("csrs_token");
  let user = null;
  try {
    user = JSON.parse(sessionStorage.getItem("csrs_user") || "null");
  } catch {
    user = null;
  }

  if (token && user) {
    const role = String(user.role || "").toLowerCase();
    const home = role === "student" || role === "staff"
      ? "/student-dashboard.html"
      : "/dashboard.html";
    document.querySelectorAll('a[href="/index.html"]').forEach((link) => {
      link.href = home;
      link.textContent = "Open workspace";
      link.classList.remove("nav-signin");
      if (link.classList.contains("module-link")) {
        link.innerHTML = 'Open workspace <span aria-hidden="true">&#8594;</span>';
      }
    });
    const register = document.querySelector(".nav-links > a.login-btn");
    if (register) {
      register.href = home;
      register.textContent = "My CSRS";
    }
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
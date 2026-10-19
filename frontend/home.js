"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const signinModal = document.getElementById("signinModal");
  const signinForm = document.getElementById("homeLogin");
  const signinMessage = document.getElementById("homeLoginMessage");
  const signinButton = document.getElementById("homeLoginButton");
  const mfaFields = document.getElementById("homeMfaFields");
  const mfaCode = document.getElementById("homeMfaCode");
  let loginChallenge = null;
  const registerModal = document.getElementById("registerModal");
  const registerForm = document.getElementById("homeRegister");
  const registerMessage = document.getElementById("homeRegisterMessage");
  const registerButton = document.getElementById("homeRegisterButton");
  const registerType = document.getElementById("homeAccountType");
  let lastTrigger = null;

  const openSignin = () => {
    registerModal.hidden = true;
    signinModal.hidden = false;
    document.getElementById("homeUsername").focus();
  };
  const closeSignin = () => {
    signinModal.hidden = true;
  };
  const openRegister = (trigger) => {
    lastTrigger = trigger || null;
    signinModal.hidden = true;
    registerModal.hidden = false;
    registerType.focus();
  };
  const closeRegister = () => {
    registerModal.hidden = true;
    if (lastTrigger) lastTrigger.focus();
  };
  const updateRegistrationHint = () => {
    const isStudent = registerType.value === "student";
    document.getElementById("homeAccountHint").textContent = isStudent
      ? "Student accounts can sign in after registration. Use your own college registration number."
      : "This account request stays inactive until an administrator approves it.";
    document.querySelector('label[for="homeRegistrationNumber"] span').textContent =
      isStudent ? "(required for students)" : "(optional)";
    document.getElementById("homeRegistrationNumber").required = isStudent;
  };

  document.querySelectorAll("[data-open-signin]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      lastTrigger = link;
      openSignin();
    });
  });
  document.querySelectorAll("[data-close-signin]").forEach((element) => {
    element.addEventListener("click", closeSignin);
  });
  document.querySelectorAll("[data-open-register]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openRegister(link);
    });
  });
  document.querySelectorAll("[data-close-register]").forEach((element) => {
    element.addEventListener("click", closeRegister);
  });
  registerType.addEventListener("change", updateRegistrationHint);
  updateRegistrationHint();

  fetch(window.CSRS.apiUrl("/api/settings/public"))
    .then((response) => response.ok ? response.json() : null)
    .then((settings) => {
      if (!settings) return;
      if (settings.registration_enabled === false) {
        const notice = document.getElementById("registrationNotice");
        if (notice) {
          notice.hidden = false;
          notice.textContent = "New account registration is temporarily closed. Contact the college for assistance.";
        }
        registerButton.disabled = true;
        registerButton.title = "Registration is currently closed";
      }
      const contact = document.getElementById("homeSupportContact");
      if (contact && (settings.support_email || settings.emergency_phone)) {
        const label = document.createElement("span");
        label.textContent = "College support: ";
        contact.append(label);
        if (settings.support_email) {
          const email = document.createElement("a");
          email.href = `mailto:${settings.support_email}`;
          email.textContent = settings.support_email;
          contact.append(email);
        }
        if (settings.support_email && settings.emergency_phone) contact.append(document.createTextNode(" · "));
        if (settings.emergency_phone) {
          const phone = document.createElement("a");
          phone.href = `tel:${settings.emergency_phone.replace(/[^+0-9]/g, "")}`;
          phone.textContent = settings.emergency_phone;
          contact.append(phone);
        }
      }
    })
    .catch(() => {});

  const signinParams = new URLSearchParams(window.location.search);
  if (signinParams.has("signin") || signinParams.has("returnTo")) openSignin();

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!signinModal.hidden) closeSignin();
      if (!registerModal.hidden) closeRegister();
    }
  });

  signinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    signinButton.disabled = true;
    signinMessage.textContent = "Signing in...";
    try {
      const response = await fetch(window.CSRS.apiUrl(loginChallenge ? "/api/auth/login/mfa" : "/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginChallenge
          ? { challenge_token: loginChallenge, code: mfaCode.value.trim() }
          : {
              username: document.getElementById("homeUsername").value.trim(),
              password: document.getElementById("homePassword").value
            })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Sign-in failed.");
      if (data.mfa_required && data.challenge_token) {
        loginChallenge = data.challenge_token;
        mfaFields.hidden = false;
        mfaCode.required = true;
        signinButton.textContent = "Verify and sign in";
        signinMessage.textContent = "Multi-factor verification is required. Enter your authenticator or recovery code.";
        mfaCode.focus();
        return;
      }
      if (!data.token || !data.user) throw new Error("The server returned an invalid login response.");
      window.CSRS.setSession(data.token, data.user);
      window.location.assign(data.user.mustChangePassword
        ? "/change-password.html"
        : window.CSRS.postLoginPath(data.user.role));
    } catch (error) {
      signinMessage.textContent = error.message;
      if (loginChallenge) mfaCode.focus();
    } finally {
      signinButton.disabled = false;
    }
  });

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    registerMessage.textContent = "";
    const password = document.getElementById("homeRegisterPassword").value;
    const confirmation = document.getElementById("homeRegisterConfirmPassword").value;
    const username = document.getElementById("homeRegisterUsername").value.trim();
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
      registerMessage.textContent = "Username must use 3–50 letters, numbers, dots, underscores or hyphens.";
      return;
    }
    if (
      password.length < 12 ||
      password !== confirmation ||
      (registerType.value === "student" &&
        !document.getElementById("homeRegistrationNumber").value.trim())
    ) {
      registerMessage.textContent = password.length < 12
        ? "Your password must contain at least 12 characters."
        : password !== confirmation
          ? "The passwords do not match."
          : "Students must provide their college registration number.";
      return;
    }
    registerButton.disabled = true;
    registerMessage.textContent = "Submitting registration...";
    try {
      const response = await fetch(window.CSRS.apiUrl("/api/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountType: registerType.value,
          fullName: document.getElementById("homeFullName").value.trim(),
          registrationNumber: document.getElementById("homeRegistrationNumber").value.trim(),
          username,
          email: document.getElementById("homeRegisterEmail").value.trim().toLowerCase(),
          phone: document.getElementById("homeRegisterPhone").value.trim(),
          password
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Registration failed.");
      registerForm.reset();
      updateRegistrationHint();
      registerMessage.textContent = data.message || "Registration submitted successfully.";
      if (data.requiresApproval) {
        registerMessage.textContent += " An administrator can approve it from User Management.";
      } else {
        window.setTimeout(() => {
          closeRegister();
          openSignin();
        }, 1800);
      }
    } catch (error) {
      registerMessage.textContent = error.message;
    } finally {
      registerButton.disabled = false;
    }
  });

  const yearElement = document.getElementById("currentYear");
  if (yearElement) yearElement.textContent = new Date().getFullYear();

  const navLinks = document.querySelectorAll(".nav-links > a");
  const homeLink = document.querySelector('.nav-links > a[href="/home.html"]');
  const sectionIds = ["services", "about"];
  function setActive(activeLink) {
    navLinks.forEach((link) => {
      if (link.classList.contains("login-btn") || link.classList.contains("nav-signin")) return;
      link.classList.toggle("active", link === activeLink);
      if (link === activeLink) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }
  if ("IntersectionObserver" in window) {
    const visible = {};
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { visible[entry.target.id] = entry.isIntersecting; });
      const current = sectionIds.find((id) => visible[id]);
      const link = current
        ? document.querySelector('.nav-links > a[href="#' + current + '"]')
        : homeLink;
      if (link) setActive(link);
    }, { rootMargin: "-25% 0px -55% 0px" });
    sectionIds.forEach((id) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });
  }
});

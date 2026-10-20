(() => {
  const CSRS = window.CSRS;
  if (!CSRS) return;

  CSRS.mountShell({ current: "help" });
  const user = CSRS.getUser();
  const role = CSRS.roleOf(user);
  const label = role ? CSRS.roleLabel(role) : "Visitor / not signed in";
  const roleLabel = document.getElementById("helpRole");
  if (roleLabel) roleLabel.textContent = label;

  const signedOut = document.getElementById("helpSignedOut");
  if (signedOut) signedOut.hidden = Boolean(CSRS.getToken());

  document.querySelectorAll("[data-help-role]").forEach((card) => {
    const allowedRoles = card.dataset.helpRole.split(",").map((value) => value.trim());
    card.hidden = !allowedRoles.includes(role);
  });

  const dashboardLink = document.getElementById("helpDashboardLink");
  if (dashboardLink && CSRS.getToken()) {
    dashboardLink.href = CSRS.homePath(role);
    dashboardLink.hidden = false;
  }
})();

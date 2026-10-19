window.CSRS_CONFIG = {
  apiBaseUrl: "https://csrs-backend.onrender.com",

  // Existing API paths
  dashboardPath: "/api/dashboard",
  incidentsPath: "/api/incidents",
  categoriesPath: "/api/incident-categories",
  locationsPath: "/api/locations",
  emergencyPath: "/api/emergency",
  visitorsPath: "/api/gate/on-campus",

  // Settings
  visitorsIncludeCheckedOut: false,
  allowAnonymous: true,
  loginPath: "/home.html",

  // Route mappings used by dashboard.js
  routes: {
    dashboard: "/api/dashboard",
    incidents: "/api/incidents",
    categories: "/api/incident-categories",
    locations: "/api/locations",
    emergency: "/api/emergency",
    visitors: "/api/gate/on-campus"
  }
};
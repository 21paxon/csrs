
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

  // API routes
  routes: {
    dashboard: "/api/dashboard",
    incidents: "/api/incidents",
    categories: "/api/incident-categories",
    locations: "/api/locations",
    emergency: "/api/emergency",
    visitors: "/api/gate/on-campus",

    // Admin user management
    users: "/api/admin/users",
    userStats: "/api/admin/users/stats",
    approveUser: "/api/admin/users/:id/approve",
    rejectUser: "/api/admin/users/:id/reject",
    activateUser: "/api/admin/users/:id/activate",
    deactivateUser: "/api/admin/users/:id/deactivate"
  }
};

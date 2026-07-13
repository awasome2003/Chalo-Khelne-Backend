/**
 * Central route registry — all API mount points live here.
 * Keeps server.js / app.js focused on bootstrap, not routing.
 */

const ROUTES = [
  // path                          // file (relative to routes/)
  ["/api",                          "./authRoutes"],
  ["/api/protected",                "./protectedRoutes"],
  ["/api/update",                   "./updateRoutes"],
  ["/api/manager",                  "./managerRoute"],
  ["/api/events",                   "./eventRoutes"],
  ["/api/agency",                   "./agencyAdminRoutes"],
  ["/api/agency-events",            "./agencyEventRoutes"],
  ["/api/club-facility",            "./clubFacilityRoutes"],
  ["/api/club",                     "./clubRoutes"],
  ["/api/tournaments",              "./tournamentRoutes"],
  ["/api/players",                  "./playerRoutes"],
  ["/api/email",                    "./emailverification"],
  ["/api/turfs",                    "./turfRoutes"],
  ["/api/trainer",                  "./trainerRoutes"],
  ["/api/referee",                  "./refereeRoutes"],
  ["/api/posts",                    "./postRoutes"],
  ["/api/notifications",            "./notificationRoutes"],
  ["/api/users",                    "./favoriteRoutes"],
  ["/api",                          "./passwordReset"],
  ["/api/clubadminprofile",         "./clubAdminProfileRoutes"],
  ["/api/club-sports",              "./clubSportsRoutes"],
  ["/api/training-schedule",        "./trainingScheduleRoutes"],
  ["/api/leave-requests",           "./leaveRequestRoutes"],
  ["/api/session-requests",         "./sessionRequestRoutes"],
  ["/api/attendance",               "./attendanceRoutes"],
  ["/api/students",                 "./studentRoutes"],
  ["/api/substitutes",              "./substituteRoutes"],
  ["/api/syllabus",                 "./syllabusRoutes"],
  ["/api/progress",                 "./progressRoutes"],
  ["/api/search",                   "./search"],
  ["/api/bulk-upload",              "./bulkUpload"],
  ["/api/sports",                   "./sportRoutes"],
  ["/api/sport-rules",              "./sportRuleBookRoutes"],
  ["/api/sport-library",            "./sportLibraryRoutes"],
  ["/api/debug",                    "./debugRoutes"],
  ["/api/payments",                 "./managerPaymentRoutes"],
  ["/api/corporate",                "./corporateRoutes"],
  ["/api/inquiries",                "./inquiryRoutes"],
  ["/api/news",                     "./newsRoutes"],
  ["/api/donations",                "./donationRoutes"],
  ["/api/onboarding",               "./onboardingRoutes"],
  ["/api/chat",                     "./chatRoutes"],
  ["/api/expenses",                 "./expenseRoutes"],
  ["/api/club-admin/finance",       "./clubAdminFinanceRoutes"],
  ["/api/roles",                    "./rbacRoutes"],
  ["/api/equipment",                "./vendorRoutes"],
  ["/api/vendors",                  "./vendorAccountRoutes"],
  ["/api/vendor-store",             "./vendorStoreRoutes"],
  ["/api/invitations",              "./invitationRoutes"],
  ["/api/coupons",                  "./couponRoutes"],
  ["/api/staff-applications",       "./staffApplicationRoutes"],
  ["/api/jobs",                     "./jobsRoutes"],
  ["/api/trainer-console",          "./trainerConsoleRoutes"],
  ["/api/player-stats",             "./playerStatsRoutes"],
  ["/api/group-chat",               "./groupChatRoutes"],
  ["/api/category-templates",       "./categoryTemplateRoutes"],
  ["/api/planner",                  "./plannerRoutes"],
  ["/api/stories",                  "./storyRoutes"],
  ["/api/follow",                   "./followRoutes"],
];

function mountAll(app) {
  ROUTES.forEach(([prefix, modulePath]) => {
    try {
      app.use(prefix, require(modulePath));
    } catch (err) {
      console.error(`[routes] Failed to mount ${prefix} from ${modulePath}:`, err.message);
    }
  });
}

module.exports = { mountAll, ROUTES };

# Module structure & ownership manifest (Phase 4)

This is the **authoritative map** of which code belongs to which module. It drives
the boundary rules in `.dependency-cruiser.js` and the per-module migration.

## Why files haven't all physically moved yet

Same prudence as deferring `Modal/` moves to Phase 5:

- `routes/index.js` `mountAll()` **catches `require` errors and only logs them** —
  a mis-pathed move would *silently drop a route group* (404), not crash.
- The integration test net does not yet hit most route groups, so a silent drop
  could pass CI.

So controllers/routes move **per module, together with that module's tests**, as
each module is migrated to the Phase-3 service/repository pattern — not in one
big-bang move. `coaching/` (service + repository) is the realized template.
Boundary **enforcement** (dependency-cruiser + ESLint + CI) is active **now**
regardless of physical location.

## Module ownership

| Module | Owns (models) | Controllers/routes that move here |
|---|---|---|
| **identity** | User, ClubManager(Manager), Superadminmodel, Substitute, RefreshToken, DeviceToken, Role, Permission, CorporateClubAdmin | authRoutes, protectedRoutes, updateRoutes, passwordReset, rbacRoutes, onboardingRoutes; authController, rbacController |
| **org** | Club, ClubSport, Turf, TurfBooking, ClubAdminProfile, ClubRequest, TrainerClubApplication, Trainer, TrainerBatch, Request, Session, Organizermodel | managerRoute, clubAdminProfileRoutes, clubSportsRoutes, turfRoutes, corporateRoutes, trainerRoutes; turfController, trainerController, corporateController, clubAdminController |
| **tournaments** | Tournament, Tournnamentmatch, TournamentMatch, DirectKnockoutMatch, KnockoutMatch, SuperMatch, semifinal, TeamKnockout*, Score, GroupStandings, BookingModel, bookinggroup, SuperPlayers, TopPlayers, CategoryTemplate, Reminder, Assignment, EventModel | tournamentRoutes, eventRoutes, bulkUpload, playerRoutes(part); tournamentController, matchController, knockoutController, directKnockoutController, teamKnockoutController, groupStageScoreboardController, tournamentLeaderboardController, BookingController, courtController, bulkResultUploadController |
| **coaching** ✅ | Student, Attendance, StudentProgress, ProgressHistory, ProgressSubmission, SportsSyllabus, SyllabusEntry, TrainingSchedule | studentRoutes, attendanceRoutes, progressRoutes, syllabusRoutes, trainingScheduleRoutes, substituteRoutes, clubSportsRoutes, trainerConsoleRoutes |
| **commerce** | Payments, Coupon, CouponUsage, Expense, ExpenseCategory, ExpensePayment, EquipmentListing, Inquiry, VendorProfile | managerPaymentRoutes, donationRoutes, vendorRoutes, vendorAccountRoutes, vendorStoreRoutes, couponRoutes, expenseRoutes, clubAdminFinanceRoutes, inquiryRoutes; vendorController, couponController, expenseController, clubAdminFinanceController |
| **social** | Post, Story, Message, Conversation, GroupChat*, Forum*, Favorite, PlayerNotification, Notification, Notification_*, Invitation, News, ProfessionalProfile, JobPosting, JobApplication, HireRequest, StaffApplication | postRoutes, notificationRoutes, favoriteRoutes, chatRoutes, groupChatRoutes, storyRoutes, followRoutes, newsRoutes, staffApplicationRoutes, jobsRoutes, plannerRoutes; notificationController |
| **catalog** | Sport, SportLibrary, SportRuleBook, Referee, refreerequestModel | sportRoutes, sportRuleBookRoutes, sportLibraryRoutes, refereeRoutes, categoryTemplateRoutes; sportController, refereeController, categoryTemplateController |
| **platform** | (no models) tenantContext, tenantScope, auth middleware, logger, errorHandler, socket, Config | utils/, middleware/, Config/, socket/ |

## Boundary rules (enforced by `.dependency-cruiser.js`)

1. A module's **non-repository** files must NOT import `Modal/` directly — go
   through that module's `*.repository.js`. (error)
2. A module must NOT import another module's internals — only its public
   `index.js` (service interface). (error)
3. `platform/` must NOT depend on any feature module. (error)
4. Flat `controllers/`/`routes/` importing `Modal/` directly = **tracked debt**
   (warn, baselined). Eliminated as each module is migrated.

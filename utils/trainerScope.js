// Resolve the effective trainer (and club) for a trainer-scoped request.
// A Manager (trainer/coach) acts as themselves. An accepted Substitute acts as
// the coach they stand in for — so they see the coach's sports/schedule/students
// and attendance is recorded under the coach.
//
// Returns { trainerId, clubId, isSubstitute, substituteId } or null if the
// caller is neither a Manager nor an active Substitute.
function effectiveTrainer(req) {
  if (req.userRole === "Manager" && req.user) {
    return { trainerId: req.user._id, clubId: req.user.clubId, isSubstitute: false, substituteId: null };
  }
  if (req.userRole === "Substitute" && req.user) {
    return {
      trainerId: req.user.coachId,
      clubId: req.user.clubId,
      isSubstitute: true,
      substituteId: req.user._id,
    };
  }
  return null;
}

module.exports = { effectiveTrainer };

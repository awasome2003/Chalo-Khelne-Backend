"use strict";
/**
 * §3.3 regression — the match-reminder cron must drain and must not re-send.
 *
 * Two defects in the original eleven lines:
 *   1. a notification with no pushToken was never marked processed, so it was
 *      re-selected by every run forever and the backlog only grew;
 *   2. the run was serial, unbounded and had no overlap guard, so a slow tick
 *      let the next one start and both selected the same rows — players got the
 *      same reminder two or three times.
 */

const mongoose = require("mongoose");
const { startTxApp, stopTxApp, clearDatabase } = require("./setupReplset");

const Notification = require("../../src/modules/social/models/Notification_Player");
// NOTE: the cron used to import sendPushNotification from matchController,
// which does not export it — the binding was `undefined` and the first
// tokenful reminder threw. The real implementation is here.
const notifications = require("../../utils/notifications");

let processDueNotifications;

beforeAll(async () => {
  await startTxApp();
  ({ processDueNotifications } = require("../../cron/notificationCron"));
  await Notification.syncIndexes();
});
afterAll(stopTxApp);
beforeEach(async () => {
  await clearDatabase();
  jest.restoreAllMocks();
});

const PAST = new Date(Date.now() - 60 * 1000);

function makeNotification(overrides = {}) {
  return {
    matchId: new mongoose.Types.ObjectId(),
    playerId: new mongoose.Types.ObjectId(),
    userName: "Reminder Player",
    reminderTime: PAST,
    minutesBefore: 10,
    pushToken: "ExponentPushToken[abc123]",
    ...overrides,
  };
}

describe("tokenless rows drain (§3.3.1)", () => {
  test("a notification with no pushToken is marked processed, not re-selected", async () => {
    jest.spyOn(notifications, "sendPushNotification").mockResolvedValue({});
    await Notification.create(makeNotification({ pushToken: null }));

    const first = await processDueNotifications();
    expect(first.skippedNoToken).toBe(1);

    const row = await Notification.findOne({}).lean();
    // Previously this stayed isProcessed:false and came back on every run.
    expect(row.isProcessed).toBe(true);
    expect(row.processedReason).toBe("no_push_token");

    // A second run finds nothing — the backlog actually drained.
    const second = await processDueNotifications();
    expect(second.claimed).toBe(0);
  });

  test("a tokenless backlog does not grow across runs", async () => {
    jest.spyOn(notifications, "sendPushNotification").mockResolvedValue({});
    await Notification.insertMany(
      Array.from({ length: 5 }, () => makeNotification({ pushToken: null }))
    );

    await processDueNotifications();
    await processDueNotifications();
    await processDueNotifications();

    expect(
      await Notification.countDocuments({ isProcessed: false })
    ).toBe(0);
  });
});

describe("no double sends (§3.3.2)", () => {
  test("each due reminder is sent exactly once", async () => {
    const spy = jest
      .spyOn(notifications, "sendPushNotification")
      .mockResolvedValue({});

    await Notification.insertMany(
      Array.from({ length: 3 }, () => makeNotification())
    );

    await processDueNotifications();
    expect(spy).toHaveBeenCalledTimes(3);

    // A subsequent tick must not resend.
    await processDueNotifications();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  test("overlapping ticks do not both send the same rows", async () => {
    // A slow push endpoint is exactly the condition that used to let node-cron
    // start a second tick over the same unclaimed rows.
    const spy = jest
      .spyOn(notifications, "sendPushNotification")
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 40))
      );

    await Notification.insertMany(
      Array.from({ length: 4 }, () => makeNotification())
    );

    const [a, b] = await Promise.all([
      processDueNotifications(),
      processDueNotifications(),
    ]);

    // The re-entry guard turns the second concurrent tick into a no-op…
    const skipped = [a, b].filter((r) => r.skipped);
    expect(skipped).toHaveLength(1);

    // …and in total each row was sent once.
    expect(spy).toHaveBeenCalledTimes(4);
    expect(await Notification.countDocuments({ isProcessed: false })).toBe(0);
  });

  test("a failing push does not wedge the queue", async () => {
    jest
      .spyOn(notifications, "sendPushNotification")
      .mockRejectedValue(new Error("Expo unavailable"));

    await Notification.create(makeNotification());

    const stats = await processDueNotifications();
    expect(stats.failed).toBe(1);

    const row = await Notification.findOne({}).lean();
    expect(row.isProcessed).toBe(true);
    expect(row.processedReason).toMatch(/send_failed/);
    expect(row.sentAt).toBeNull();

    // Not retried into an infinite loop.
    const second = await processDueNotifications();
    expect(second.claimed).toBe(0);
  });
});

describe("the query is bounded (§3.3.2)", () => {
  test("future reminders are not picked up", async () => {
    const spy = jest
      .spyOn(notifications, "sendPushNotification")
      .mockResolvedValue({});

    await Notification.create(
      makeNotification({ reminderTime: new Date(Date.now() + 60 * 60 * 1000) })
    );

    const stats = await processDueNotifications();
    expect(stats.claimed).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

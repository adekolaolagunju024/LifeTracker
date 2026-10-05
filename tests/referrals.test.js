const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const dbFile = path.join(os.tmpdir(), `waypoint-referrals-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
const db = require('../backend/db/db');

after(() => {
  require('../backend/db/connection').close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbFile + suffix, { force: true });
});

const newUser = () => db.createUser({ id: randomUUID(), email: `ref_${randomUUID()}@example.com`, passwordHash: 'x', createdAt: new Date().toISOString(), acceptedTermsAt: new Date().toISOString() });
const newGoal = userId => db.createProject(userId, { id: randomUUID(), title: 'Goal', isGoal: true, createdAt: new Date().toISOString() });

test('a personal code is created once and stays the same', () => {
  const user = newUser();
  const first = db.getReferralCode(user.id);
  assert.ok(first && first.length === 8);
  assert.equal(db.getReferralCode(user.id), first);
});

test('an unknown code is ignored', () => {
  const user = newUser();
  assert.equal(db.attachReferral(user.id, 'nope-nope'), false);
  assert.equal(db.getUserById(user.id).referredBy, null);
});

test('an account cannot refer itself', () => {
  const user = newUser();
  assert.equal(db.attachReferral(user.id, db.getReferralCode(user.id)), false);
});

test('a valid code links the new account and counts as a join', () => {
  const referrer = newUser();
  const referee = newUser();
  assert.equal(db.attachReferral(referee.id, db.getReferralCode(referrer.id)), true);
  assert.equal(db.getUserById(referee.id).referredBy, referrer.id);
  assert.equal(db.getReferralStats(referrer.id).joined, 1);
});

test('the first goal pays both sides once, and a second goal pays nothing more', () => {
  const referrer = newUser();
  const referee = newUser();
  db.attachReferral(referee.id, db.getReferralCode(referrer.id));
  newGoal(referee.id);
  assert.equal(db.rewardReferralFor(referee.id), true);
  assert.equal(db.getProfile(referrer.id).bonusAiCredits, 20);
  assert.equal(db.getProfile(referee.id).bonusAiCredits, 20);
  assert.equal(db.rewardReferralFor(referee.id), false, 'already rewarded');
  assert.equal(db.getProfile(referee.id).bonusAiCredits, 20);
});

test('a referrer earns rewards for at most 25 referees', () => {
  const referrer = newUser();
  for (let i = 0; i < 26; i++) {
    const referee = newUser();
    db.attachReferral(referee.id, db.getReferralCode(referrer.id));
    newGoal(referee.id);
    db.rewardReferralFor(referee.id);
  }
  assert.equal(db.getReferralStats(referrer.id).rewarded, 25);
  assert.equal(db.getProfile(referrer.id).bonusAiCredits, 25 * 20);
});

test('bonus credits are spent only after the daily allowance is used up', () => {
  const user = newUser();
  let allowed = 0;
  for (let i = 0; i < 15; i++) if (db.consumeAiQuota(user.id)) allowed++;
  assert.equal(allowed, 15);
  assert.equal(db.consumeAiQuota(user.id), false, 'no bonus yet, so refused');

  db.updateProfile(user.id, {});
  const raw = require('better-sqlite3')(dbFile);
  raw.prepare('UPDATE profile SET bonusAiCredits = 2 WHERE userId = ?').run(user.id);
  raw.close();
  assert.equal(db.consumeAiQuota(user.id), true, 'bonus covers the call');
  assert.equal(db.getProfile(user.id).bonusAiCredits, 1);
});

test('invites sent today are counted for the daily limit', () => {
  const user = newUser();
  assert.equal(db.invitesSentToday(user.id), 0);
  for (let i = 0; i < 3; i++) db.logEvent(user.id, 'invite_sent');
  assert.equal(db.invitesSentToday(user.id), 3);
  assert.equal(db.getReferralStats(user.id).invitesLeftToday, db.INVITES_PER_DAY - 3);
});

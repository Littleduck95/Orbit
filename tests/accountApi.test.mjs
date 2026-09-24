// The rules for a new account, checked as someone types. The database checks
// them again (see tests/db); these are the words people see.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageOn, authMessage, birthdayProblem, cleanUsername, emailProblem, passwordProblem, signUpProblems, usernameProblem,
} from '../src/accountApi.js';

const DAY = new Date(2026, 8, 24, 12);

describe('usernames', () => {
  it('are stored lowercase, without a leading @ or spaces', () => {
    assert.equal(cleanUsername('  @Brock_B '), 'brock_b');
  });
  it('accept letters, numbers, dots and underscores, starting with a letter', () => {
    for (const ok of ['bea', 'brock_b', 'b.boyer98', 'Abc', 'a'.repeat(20)]) assert.equal(usernameProblem(ok), '', ok);
  });
  it('say what is wrong with the rest', () => {
    assert.equal(usernameProblem(''), 'Pick a username.');
    assert.equal(usernameProblem('ab'), 'At least 3 characters.');
    assert.equal(usernameProblem('a'.repeat(21)), 'At most 20 characters.');
    assert.equal(usernameProblem('9lives'), 'Start with a letter.');
    assert.equal(usernameProblem('no spaces'), 'Only letters, numbers, dots and underscores.');
    assert.equal(usernameProblem('emoji🙂'), 'Only letters, numbers, dots and underscores.');
    assert.equal(usernameProblem('a..b'), 'No dots or underscores together or at the end.');
    assert.equal(usernameProblem('abc_'), 'No dots or underscores together or at the end.');
    assert.equal(usernameProblem('Admin'), 'That one is reserved.');
  });
  it('match what the database accepts', () => {
    // The same pattern as the check on profiles.username in supabase/schema.sql.
    const db = (u) => /^[a-z][a-z0-9._]{2,19}$/.test(u) && !/[._]{2}/.test(u) && !/[._]$/.test(u);
    for (const u of ['bea', 'brock_b', 'a..b', 'abc_', '9lives', 'ab', 'x.y_z9', 'a'.repeat(20), 'a'.repeat(21)]) {
      assert.equal(usernameProblem(u) === '' || usernameProblem(u) === 'That one is reserved.', db(cleanUsername(u)), u);
    }
  });
});

describe('passwords and emails', () => {
  it('need at least 8 characters, and no spaces at the ends', () => {
    assert.equal(passwordProblem('1234567'), 'At least 8 characters.');
    assert.equal(passwordProblem('12345678'), '');
    assert.equal(passwordProblem(' 12345678'), 'No spaces at the start or end.');
    assert.equal(passwordProblem('x'.repeat(73)), 'At most 72 characters.');
  });
  it('need something that looks like an email', () => {
    assert.equal(emailProblem(''), 'Enter your email.');
    assert.equal(emailProblem('brock'), 'That does not look like an email address.');
    assert.equal(emailProblem(' brock@example.com '), '');
  });
});

describe('birthdays', () => {
  it('count whole years, turning on the day itself', () => {
    assert.equal(ageOn('2013-09-24', DAY), 13);
    assert.equal(ageOn('2013-09-25', DAY), 12);
    assert.equal(ageOn('2000-02-29', DAY), 26);
    assert.equal(ageOn('nope', DAY), null);
  });
  it('require 13 or older', () => {
    assert.equal(birthdayProblem('2013-09-24', DAY), '');
    assert.equal(birthdayProblem('2013-09-25', DAY), 'Orbit is for people 13 and older.');
    assert.equal(birthdayProblem('2030-01-01', DAY), 'That date is in the future.');
    assert.equal(birthdayProblem('1850-01-01', DAY), 'That date does not look right.');
    assert.equal(birthdayProblem('', DAY), 'Enter your birthday.');
  });
});

describe('a whole sign-up form', () => {
  it('lists every problem by field, and nothing when it is ready', () => {
    assert.deepEqual(Object.keys(signUpProblems({}, DAY)).sort(), ['birthday', 'displayName', 'email', 'password', 'username']);
    assert.deepEqual(signUpProblems({
      displayName: 'Brock', username: 'brock_b', email: 'b@example.com', password: 'longenough', birthday: '1998-04-02',
    }, DAY), {});
  });
});

describe('messages from the server', () => {
  it('are put in plain words', () => {
    assert.match(authMessage({ message: 'Invalid login credentials' }), /do not match an account/);
    assert.match(authMessage({ message: 'Email not confirmed' }), /Confirm your email first/);
    assert.match(authMessage({ message: 'User already registered' }), /already an account/);
    assert.match(authMessage({ message: 'Database error saving new user' }), /username may have just been taken/);
    assert.match(authMessage({ message: 'duplicate key value violates unique constraint "profiles_username_key"' }), /username is taken/);
    assert.match(authMessage({ message: 'Orbit is for people 13 and older' }), /13 and older/);
    assert.match(authMessage({ message: 'TypeError: Failed to fetch' }), /could not reach/);
    assert.equal(authMessage({ message: 'Something new' }), 'Something new');
  });
});

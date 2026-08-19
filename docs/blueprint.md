# GiftGiver Bot — Bot specification

**Archetype:** community

**Voice:** cheerful and playful — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that randomly selects active chat participants and awards them virtual gifts, boosting engagement with playful public announcements. The bot tracks recent activity, schedules automatic giveaways every 5-90 minutes, and allows manual /gift triggers, ensuring winners are not repeated too often.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Telegram group chat admins
- community managers
- social group organizers

## Success criteria

- Scheduled automatic giveaways run reliably
- Manual /gift command triggers a giveaway immediately
- Winners are announced with playful messages in the chat
- Active users are tracked and used for random selection
- Recent winners are stored to avoid immediate repeats

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu
- **/gift** (command, actor: user, command: /gift) — Trigger an immediate giveaway

## Flows

### Automatic Giveaway
_Trigger:_ timer

1. Check active users in the last 30 minutes
2. Select random user who hasn't won recently
3. Pick random gift from the gift pool
4. Announce winner in chat

_Data touched:_ active_participants, gift_pool, giveaway_event

### Manual Giveaway
_Trigger:_ /gift

1. Check active users in the last 30 minutes
2. Select random user who hasn't won recently
3. Pick random gift from the gift pool
4. Announce winner in chat

_Data touched:_ active_participants, gift_pool, giveaway_event

### Track Active Users
_Trigger:_ message received

1. Add user to active participants list
2. Update last seen timestamp

_Data touched:_ active_participants

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **active_participants** _(retention: persistent)_ — Users who have sent messages in the last 30 minutes
  - fields: user_id, username, last_seen
- **gift_pool** _(retention: persistent)_ — List of available virtual gifts
  - fields: gift_name, emoji
- **giveaway_event** _(retention: persistent)_ — Record of each giveaway event
  - fields: timestamp, winner_id, gift, trigger

## Integrations

- **Telegram** (required) — Bot API messaging and user tracking
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Edit gift pool items
- Adjust active user window duration
- Change repeat protection rules
- Modify giveaway interval range
- Set username mention format
- Enable/disable automatic giveaways

## Notifications

- Public chat announcements for winners

## Permissions & privacy

- The bot stores user IDs and usernames for tracking activity and avoiding repeat winners within a short period. No personal data is shared or stored beyond the chat context.

## Edge cases

- No active users in the current window
- All eligible users have won recently and are blocked by repeat protection
- Gift pool is empty

## Required tests

- Verify automatic giveaways run on schedule
- Test /gift command triggers a giveaway
- Ensure winners are not repeated too frequently
- Validate public announcement format with emojis
- Confirm active user tracking works after messages are sent

## Assumptions

- Users with recent activity are eligible for giveaways
- Gift pool contains at least 10 items by default
- Repeat protection prevents the same user from winning 3 consecutive giveaways
- Giveaway intervals are between 5 and 90 minutes

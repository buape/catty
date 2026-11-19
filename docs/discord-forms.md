# Discord forms

`discord_form` registers a modal against a button on an existing Discord message. This handles Discord's three-second response deadline without asking the model to produce a modal after the interaction has already been deferred.

Send the button first using a Components V2 response, then register its exact guild, channel, message and custom ID:

```json
{
  "action": "register",
  "form": {
    "customId": "example-start",
    "guildId": "123",
    "channelId": "456",
    "messageId": "789",
    "title": "Example form",
    "skill": "example",
    "fields": [
      {"id": "dates", "label": "Dates", "type": "text", "maxLength": 200},
      {"id": "reason", "label": "Reason", "type": "paragraph", "maxLength": 1000},
      {"id": "private", "label": "Keep reason private", "type": "checkbox"}
    ]
  }
}
```

The workspace must contain `skills/example/SKILL.md` describing how the agent should handle the submission. Define authorization, input handling, privacy, external effects, tracking and failure recovery there. Form registration does not grant permission for role changes, moderation or other writes.

- Text fields are required by default; use `required:false` for optional text. Text fields default to a 1000-character limit, with a maximum of 4000.
- Forms support one to five fields with unique IDs. Checkbox fields default to unchecked and produce booleans, not strings.
- Optional `blockedRoleIds` rejects members holding any listed role before opening the form. `blockedMessage` customizes the ephemeral rejection. Recheck roles in the skill before performing effects.
- Existing Catty guild/channel/user authorization applies to both opening and submitting forms.
- Definitions persist in the workspace's `.internal/discord-forms.json`. Open-modal challenges are user/guild/channel bound, single-use, and expire after 15 minutes or a restart. A stale form asks the member to reopen it.
- Successful submissions are deferred ephemerally and queued in the normal agent runtime. The prompt identifies the selected skill and supplies the actor, original button/message IDs and parsed fields as untrusted data. Interaction tokens are not included in prompts.
- Business effects are agent-driven. The form transport does not post domain notices, change roles, delete messages or schedule jobs.
- `{"action":"list"}` lists definitions. `{"action":"remove","customId":"example-start","messageId":"789"}` removes a registration. Modals already opened before removal remain valid until expiry/restart.

Form values are included in the normal local agent session history. A private checkbox is application data, not a request to make the model's local storage ephemeral. Skills must ensure private values are sent only to approved recipients and never repeated in public acknowledgements.

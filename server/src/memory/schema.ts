// Default wiki/SCHEMA.md (spec 10 §10.3): page conventions for the librarian; the file is data, editable.
export const DEFAULT_SCHEMA = `# Wiki schema

Conventions for the memory wiki. The librarian follows this file; edit it to change the conventions.

## Pages

- One page per entity (person, place, pet, organisation, project, device) under \`entities/\`,
  one page per concept (topic, interest, routine, recurring theme) under \`concepts/\`.
- Slug: lowercase \`[a-z0-9-]\`, at most 64 characters, unique across both directories.
- The primary user is the entity \`user\` (kind person). Their name, household, location and
  timezone go on that page.
- Frontmatter: type, kind, title, aliases, summary (at most 120 characters), sources, facts.
  \`created\` and \`updated\` are set by the server.
- Body: H2 sections. Always \`## Summary\` first; \`## Related\` with \`[[slug]]\` links last.
- Page size at most 8 KB; split larger pages into sub-pages and link them.

## What goes where

- Descriptive, stable knowledge ("who / what is X") → wiki page prose.
- Time-varying statements → temporal facts, never prose:
  - preference: what someone likes or dislikes (topic = dotted normalised key, e.g. \`coffee.milk\`);
  - decision: a choice made, with reason;
  - event: something that happens at a time (with RRULE for recurring events).
  Reference fact ids in the page's \`facts\` list.
- A changed preference or revised decision → \`facts_supersede\` (never a second open fact on one topic).
- A fact that was recorded wrong → \`facts_retract\`, then assert the corrected one with its original window.

## Sources

- Record the source turn ref (\`YYYY-MM-DD/<session>#t<n>\`) in page \`sources\` and fact \`source\`.
- Only record what the user said or confirmed. Assistant statements are not facts about the user.
- confidence \`stated\` for explicit statements, \`inferred\` otherwise; prefer not recording weak inferences.
- Ignore small talk, questions about general knowledge, and anything not about the user's life.

## Style

- Refer to people by name. Do not infer anyone's gender or pronouns; use a pronoun only if the person stated it.
- Times are stored in UTC (ISO 8601 with Z); convert stated local times with the user's timezone.
`;

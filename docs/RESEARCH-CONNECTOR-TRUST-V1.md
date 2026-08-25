# Research Connector and Trust Model v1

CS-8 defines a provider-neutral metadata and trust boundary for research acquisition. It broadens access without confusing access with authority.

## Connector metadata

A connector record declares:

- platform and authentication mode;
- capabilities and health;
- default source trust tier;
- source URL and access time;
- raw artifact hash when a connector-produced artifact exists.

Health states include healthy, degraded, unavailable, authentication expired, and unknown. Unavailable, expired, and unknown connectors cannot admit evidence.

## Evidence trust gate

Evidence metadata carries its connector key, source URL, source label, access time, raw artifact hash, claim class, and source trust tier.

The trust hierarchy is explicit:

1. primary;
2. institutional;
3. reputable secondary;
4. community;
5. unverified.

The admission gate requires:

- evidence and connector identity to match;
- evidence trust not to exceed the connector's declared trust tier;
- evidence trust to meet the claim's minimum tier;
- claim class to match;
- raw artifact hash when required.

Therefore community or social evidence cannot silently satisfy a primary-authority gate. It can still support an exploratory claim when the requirement explicitly permits it.

This contract adds no source connector, credential, scraping, network call, routing, qualification, Supabase, or Production write. The next step is to add individual adapters behind this boundary and preserve raw provenance for every admitted artifact.

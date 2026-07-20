# RC known limitations

- Physical iPhone microphone permission, VAD, barge-in, output routing,
  Bluetooth, lock/background transitions and Wi-Fi/5G changes remain device-bound.
- Today/Wardrobe gesture feel, safe areas, Dynamic Type, VoiceOver and subjective
  motion rhythm require final physical-device review.
- Production live provider routes remain intentionally fail closed until both Upstash
  credentials are configured in Vercel. Preview/mock validation cannot prove the
  account-side rate policy.
- This audit does not use paid providers for fuzz, load or recommendation eval. A
  bounded Realtime token smoke is manual; Sol/Terra/Photoroom live quality is not a CI gate.
- CSP uses static inline allowances required by the current Next bootstrap/style
  strategy; third-party scripts and unlisted connections remain blocked.

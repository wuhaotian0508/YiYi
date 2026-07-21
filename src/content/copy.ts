export const copy = {
  permission: {
    title: "YiYi is built around live voice.",
    body: "Microphone access is required for live voice. YiYi also uses approximate location only to check today’s weather.",
    denied: "YiYi needs microphone access to understand your day and adjust your outfit naturally.",
    allow: "Allow Microphone",
    settings: "Open Settings",
  },
  calibration: {
    likes: "Which looks feel most like you?",
    likesHint: "Like, pass, or skip. There is no required count.",
    least: "What would you like to see less often?",
    avoid: "Anything YiYi should usually avoid?",
    profile: "Your style so far",
  },
  today: {
    prompt: "Tell YiYi about your day.",
    example: "Class in the morning, dinner tonight, and lots of walking.",
    listening: "Listening…",
    understanding: "Got it.",
  },
  outfit: {
    main: "I’d wear this one today.",
    reason: "Cool and effortless, but still works well for photos.",
    revised: "Better. I kept everything else.",
    listening: "YiYi is listening…",
    wear: "Wear this today",
    undo: "Undo",
    confirmedTitle: "Outfit decided.",
    confirmedBody: "One less thing to think about.",
  },
  wardrobe: {
    title: "My wardrobe",
    empty: "Your wardrobe is empty",
    emptyBody: "Add your first items so YiYi can style them for you.",
    add: "Add items",
  },
  preferences: {
    resetConfirm: "Reset all saved preferences and start fresh?",
  },
  processing: {
    removing: "Removing background…",
    understanding: "Understanding the item…",
    ready: "Ready to add",
    failed: "Something went wrong",
    failedBody: "We couldn’t process this item. Please try again.",
  },
} as const;

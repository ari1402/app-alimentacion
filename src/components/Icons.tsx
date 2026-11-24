// Íconos SVG mínimos (sin dependencias)
const P = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const IconHome = () => (<svg width="22" height="22" viewBox="0 0 24 24" {...P}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>);
export const IconChart = () => (<svg width="22" height="22" viewBox="0 0 24 24" {...P}><path d="M3 20h18M6 16l4-5 3 3 5-7" /></svg>);
export const IconPlus = () => (<svg width="24" height="24" viewBox="0 0 24 24" {...P} strokeWidth={2.5}><path d="M12 5v14M5 12h14" /></svg>);
export const IconDumbbell = () => (<svg width="22" height="22" viewBox="0 0 24 24" {...P}><path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12" /></svg>);
export const IconChat = () => (<svg width="22" height="22" viewBox="0 0 24 24" {...P}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>);
export const IconGear = () => (<svg width="22" height="22" viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>);
export const IconMic = () => (<svg width="20" height="20" viewBox="0 0 24 24" {...P}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>);
export const IconCamera = () => (<svg width="20" height="20" viewBox="0 0 24 24" {...P}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>);
export const IconTrash = () => (<svg width="18" height="18" viewBox="0 0 24 24" {...P}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>);
export const IconStar = ({ on }: { on?: boolean }) => (<svg width="18" height="18" viewBox="0 0 24 24" {...P} fill={on ? "currentColor" : "none"}><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" /></svg>);
export const IconBack = () => (<svg width="22" height="22" viewBox="0 0 24 24" {...P}><path d="M15 5l-7 7 7 7" /></svg>);

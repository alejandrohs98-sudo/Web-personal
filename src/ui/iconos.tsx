// Iconos en línea (trazo de 24 px). Sin fuentes ni librerías externas.
const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, viewBox: '0 0 24 24', 'aria-hidden': true };

export const IconoHoy = () => (<svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>);
export const IconoMenu = () => (<svg {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
export const IconoCompra = () => (<svg {...p}><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" /><circle cx="10" cy="20.5" r="1" /><circle cx="17" cy="20.5" r="1" /></svg>);
export const IconoRecetas = () => (<svg {...p}><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Zm0 0A2 2 0 0 0 6 22h13" /><path d="M9 7h6M9 11h6" /></svg>);
export const IconoEntreno = () => (<svg {...p}><circle cx="14" cy="4" r="2" /><path d="m6 22 3.5-6 3 2v4M8.5 11 11 7l3.5 2 2 3.5H20M11 7l-1.5 5 3 2" /></svg>);
export const IconoMas = () => (<svg {...p}><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></svg>);
export const IconoAtras = () => (<svg {...p}><path d="m15 18-6-6 6-6" /></svg>);

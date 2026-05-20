// src/constants.js

export const CATEGORIES = {
  "Nourriture":           { icon: "🍽️", color: "#E8F5E9", accent: "#2E7D32",  subs: ["Entrée", "Plat", "Dessert", "Autre"] },
  "Boisson":              { icon: "🥤", color: "#E3F2FD", accent: "#1565C0",  subs: ["Alcool", "Jus", "Eau", "Autre"] },
  "Transport":            { icon: "🚖", color: "#FFF8E1", accent: "#F57F17",  subs: ["Taxi", "Tram", "Bus", "Train", "Avion", "Autre"] },
  "Accessoires":          { icon: "🎉", color: "#F3E5F5", accent: "#6A1B9A",  subs: ["Décoration", "Fournitures", "Équipement", "Autre"] },
  "Hébergement":          { icon: "🏨", color: "#E0F7FA", accent: "#00695C",  subs: ["Hôtel", "Airbnb", "Auberge", "Autre"] },
  "Loisirs & Activités":  { icon: "🎭", color: "#FCE4EC", accent: "#AD1457",  subs: ["Cinéma", "Concert", "Musée", "Autre"] },
  "Courses & Épicerie":   { icon: "🛒", color: "#F1F8E9", accent: "#558B2F",  subs: ["Supermarché", "Marché", "Boulangerie", "Autre"] },
  "Loyer & Factures":     { icon: "💡", color: "#FFFDE7", accent: "#F9A825",  subs: ["Loyer", "Électricité", "Internet", "Autre"] },
  "Cadeaux":              { icon: "🎁", color: "#FBE9E7", accent: "#BF360C",  subs: ["Anniversaire", "Mariage", "Naissance", "Autre"] },
  "Santé & Bien-être":    { icon: "💊", color: "#E8EAF6", accent: "#283593",  subs: ["Médecin", "Pharmacie", "Salle de sport", "Autre"] },
  "Technologie & Services":{ icon: "📱", color: "#ECEFF1", accent: "#455A64", subs: ["Abonnement", "Logiciel", "Appareil", "Autre"] },
  "Autre":                { icon: "❓", color: "#F5F5F5", accent: "#757575",  subs: ["Autre"] },
};

export const CURRENCIES = ["EUR €", "USD $", "GBP £", "XOF FCFA", "MAD DH", "CAD $"];

export const PERSONAL_CATEGORIES = {
  "Logement":        { icon: "🏠", color: "#E3F2FD", accent: "#1565C0",
                       subs: ["Loyer", "Charges", "Assurance habitation", "Réparations", "Autre"] },
  "Alimentation":    { icon: "🛒", color: "#E8F5E9", accent: "#2E7D32",
                       subs: ["Courses", "Restaurants", "Livraison", "Café", "Autre"] },
  "Transport":       { icon: "🚗", color: "#FFF8E1", accent: "#F57F17",
                       subs: ["Carburant", "Transport commun", "Parking", "Entretien", "Autre"] },
  "Santé":           { icon: "💊", color: "#E8EAF6", accent: "#283593",
                       subs: ["Médecin", "Pharmacie", "Mutuelle", "Sport", "Autre"] },
  "Loisirs":         { icon: "🎭", color: "#FCE4EC", accent: "#AD1457",
                       subs: ["Sorties", "Streaming", "Sport", "Lecture", "Autre"] },
  "Vêtements":       { icon: "👕", color: "#F3E5F5", accent: "#6A1B9A",
                       subs: ["Vêtements", "Chaussures", "Accessoires", "Autre"] },
  "Abonnements":     { icon: "📱", color: "#ECEFF1", accent: "#455A64",
                       subs: ["Téléphone", "Internet", "Streaming", "Presse", "Autre"] },
  "Épargne":         { icon: "💎", color: "#E0F7FA", accent: "#00695C",
                       subs: ["Virement épargne", "Investissement", "Assurance vie", "Autre"] },
  "Famille":         { icon: "👨‍👩‍👧", color: "#FFF3E0", accent: "#E65100",
                       subs: ["Enfants", "Cadeaux", "Aide proche", "Autre"] },
  "Impôts & Taxes":  { icon: "🏛️", color: "#FAFAFA", accent: "#616161",
                       subs: ["Impôt revenu", "Taxe habitation", "Cotisations", "Autre"] },
  "Divers":          { icon: "❓", color: "#F5F5F5", accent: "#757575",
                       subs: ["Autre"] },
};

export const CURRENCY_CODES = {
  "EUR €":    "eur",
  "USD $":    "usd",
  "GBP £":    "gbp",
  "XOF FCFA": "xof",
  "MAD DH":   "mad",
  "CAD $":    "cad",
};

export const AVATAR_EMOJIS = ["😀","😎","🥳","🤩","🦁","🐯","🐻","🦊","🐼","🐨","🦄","🐸","🦋","🌟","⚡","🔥","🌈","🎯","🎸","🚀","💎","🌺","🍀","🎭","👑"];

export const AVATAR_STORAGE_KEY = "splitly_avatars";

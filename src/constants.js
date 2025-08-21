import { rgb, StandardFonts } from "pdf-lib";

export const LOGO_URL = "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png";
export const DEFAULT_MSA_TERMS_URL = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
export const DEFAULT_DEBIT_TERMS_URL = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
export const PDF_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days

// Brand
export const VINET_RED = rgb(237/255, 28/255, 36/255);
export const VINET_BLACK = rgb(3/255, 3/255, 3/255);

// Header defaults
export const HEADER_WEBSITE_DEFAULT = "www.vinet.co.za";
export const HEADER_PHONE_DEFAULT = "021 007 0200";

// PDF fonts (Times to avoid WinAnsi issues)
export const PDF_FONTS = {
  body: StandardFonts.TimesRoman,
  bold: StandardFonts.TimesRomanBold,
};

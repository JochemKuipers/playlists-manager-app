import { startWhatsNewAutoSync } from "@/operations/whatsNewAuto";

(async () => {
  while (!Spicetify?.Platform || !Spicetify?.LocalStorage) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  startWhatsNewAutoSync();
})();

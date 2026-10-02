# FOMO · collecteur gratuit

Ce dossier récupère chaque nuit les événements de **Shotgun**, **Resident Advisor**, **BilletReduc** et **Ticketac** pour ta ville et tes destinations, puis les écrit dans `data/`. L'app FOMO lit ces fichiers. Tout tourne gratuitement sur GitHub Actions.

## Mise en place (10 minutes)

1. Crée un compte gratuit sur github.com, puis un dépôt **public** nommé `fomo-collector`.
2. Dans le dépôt : **Add file → Upload files**, et dépose tout le contenu de ce dossier, y compris le dossier caché `.github` (sur Mac, Cmd + Maj + . pour afficher les fichiers cachés dans le Finder). Si le dossier `.github` ne passe pas : **Add file → Create new file**, tape `.github/workflows/collect.yml` comme nom, colle le contenu du fichier, et enregistre.
3. Onglet **Actions** : active les workflows, ouvre « FOMO collecte » et clique sur **Run workflow**. La première collecte prend 5 à 15 minutes.
4. Crée un jeton : Settings → Developer settings → Personal access tokens → **Fine-grained tokens**, limité au dépôt `fomo-collector`, avec **Contents** et **Actions** en lecture et écriture.
5. Dans FOMO, va dans **Profil → Collecteur gratuit**, colle `ton-pseudo/fomo-collector` et le jeton.

Ensuite, FOMO ajoute automatiquement ta ville et tes villes de destination (lues dans ton agenda) à `config/cities.json`, et relance une collecte quand elles changent.

## Ce que récupère chaque source

| Source | Contenu | Remarque |
|---|---|---|
| Shotgun | Date, lieu avec GPS, line-up, prix | Jusqu'à 60 événements par ville |
| Resident Advisor | Date, lieu, line-up, nombre d'intéressés, sélection de la rédaction | Jusqu'à 150 soirées sur 60 jours |
| BilletReduc | Théâtre et seul-en-scène : prochaine date, lieu, prix, note des spectateurs | Jusqu'à 60 spectacles par ville |
| Ticketac | Titre, image, prix (Paris) | Les dates ne sont pas lisibles : choix de la date sur Ticketac |

Si une source échoue (site qui bloque les robots, page modifiée), les autres continuent ; l'échec est visible dans FOMO et dans les journaux de l'onglet Actions.

## À savoir

Ce robot lit des pages publiques à un rythme lent (une page par seconde, une fois par nuit), mais sans accord de ces sites. C'est acceptable pour un prototype personnel ; pour un lancement public, il faudra des partenariats.

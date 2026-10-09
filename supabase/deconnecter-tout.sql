-- Déconnecte TOUS les appareils de TOUS les comptes de ce projet (y compris une session restée sur
-- l'ancienne adresse). Aucune donnée de l'atelier n'est touchée : il suffit de se reconnecter
-- (mot de passe + code).
-- ⚠️ Les jetons d'accès déjà émis restent valables jusqu'à leur expiration (1 h par défaut) : pour une
-- coupure immédiate, baisser d'abord cette durée dans Authentication → Sessions.
-- À coller dans Supabase → SQL Editor → Run.
delete from auth.sessions;
select count(*) as sessions_restantes from auth.sessions;

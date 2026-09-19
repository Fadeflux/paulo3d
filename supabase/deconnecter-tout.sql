-- Déconnecte TOUS les appareils du compte (y compris une session restée sur l'ancienne adresse).
-- Aucune donnée de l'atelier n'est touchée : il suffit de se reconnecter (mot de passe + code).
-- À coller dans Supabase → SQL Editor → Run.
delete from auth.sessions;
select count(*) as sessions_restantes from auth.sessions;

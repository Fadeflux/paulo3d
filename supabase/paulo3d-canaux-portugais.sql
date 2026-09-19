-- Paulo3D passe en portugais (une seule fois, sur la base de Paulo3D uniquement).
-- Les canaux de vente créés par défaut à la première connexion portent des noms français : ils sont
-- renommés en portugais, SEULEMENT s'ils n'ont pas été modifiés depuis. Rejouable sans effet.
update public.settings s
   set sales_channels = (
     select jsonb_agg(
              case
                when c ->> 'id' = 'direct'    and c ->> 'name' = 'Main propre'    then jsonb_set(c, '{name}', '"Em mão"')
                when c ->> 'id' = 'leboncoin' and c ->> 'name' = 'Leboncoin'      then jsonb_set(c, '{name}', '"OLX"')
                when c ->> 'id' = 'site'      and c ->> 'name' = 'Site web'       then jsonb_set(c, '{name}', '"Site"')
                when c ->> 'id' = 'salon'     and c ->> 'name' = 'Salon / marché' then jsonb_set(c, '{name}', '"Feira / mercado"')
                else c
              end order by t.ord)
       from jsonb_array_elements(s.sales_channels) with ordinality as t(c, ord))
 where jsonb_typeof(s.sales_channels) = 'array'
   and jsonb_array_length(s.sales_channels) > 0;

-- contrôle : noms des canaux après renommage
select jsonb_path_query_array(sales_channels, '$[*].name') as canaux from public.settings;

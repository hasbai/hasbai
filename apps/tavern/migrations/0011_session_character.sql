ALTER TABLE sessions ADD COLUMN character_id TEXT;
UPDATE sessions SET character_id = (
 SELECT characters.id FROM characters
 WHERE characters.owner = sessions.owner AND characters.card_json = sessions.character_json
 ORDER BY characters.id LIMIT 1
) WHERE deleted_at IS NULL;

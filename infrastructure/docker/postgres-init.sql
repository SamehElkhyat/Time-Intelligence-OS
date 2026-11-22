-- Runs once when the postgres volume is first created.
-- A separate database keeps integration tests away from development/demo data.
CREATE DATABASE timeflow_test OWNER timeflow;

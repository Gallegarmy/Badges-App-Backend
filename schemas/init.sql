-- Create role explicitly
CREATE ROLE badges_user
  LOGIN
  PASSWORD 'Nico1001';

-- Create database owned by that role
CREATE DATABASE badges
  OWNER badges_user;

GRANT ALL PRIVILEGES ON DATABASE badges TO badges_user;

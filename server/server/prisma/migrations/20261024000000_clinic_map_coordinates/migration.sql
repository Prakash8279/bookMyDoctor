ALTER TABLE "clinics"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION;

ALTER TABLE "clinics"
  ADD CONSTRAINT "clinics_coordinates_pair_check"
  CHECK ((latitude IS NULL AND longitude IS NULL) OR
         (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180));

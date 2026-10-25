-- Reference categories only. No doctor profiles are created or assigned here.
INSERT INTO "specializations" ("id", "name", "icon", "description") VALUES
  (gen_random_uuid(), 'Pediatrician', 'baby', 'Child and adolescent health'),
  (gen_random_uuid(), 'Gynecologist', 'venus', 'Women’s reproductive health'),
  (gen_random_uuid(), 'Orthopedic Surgeon', 'bone', 'Bones, joints, and musculoskeletal care'),
  (gen_random_uuid(), 'Neurologist', 'brain', 'Brain, nerve, and neurological care'),
  (gen_random_uuid(), 'Psychiatrist', 'brain', 'Mental health assessment and treatment'),
  (gen_random_uuid(), 'ENT Specialist', 'ear', 'Ear, nose, and throat care'),
  (gen_random_uuid(), 'Ophthalmologist', 'eye', 'Eye and vision care'),
  (gen_random_uuid(), 'Dentist', 'tooth', 'Dental and oral care'),
  (gen_random_uuid(), 'Gastroenterologist', 'activity', 'Digestive system care'),
  (gen_random_uuid(), 'Pulmonologist', 'lungs', 'Lung and respiratory care'),
  (gen_random_uuid(), 'Nephrologist', 'kidney', 'Kidney care'),
  (gen_random_uuid(), 'Urologist', 'kidney', 'Urinary tract and male reproductive care'),
  (gen_random_uuid(), 'Endocrinologist', 'activity', 'Hormone and metabolic conditions'),
  (gen_random_uuid(), 'Oncologist', 'activity', 'Cancer care'),
  (gen_random_uuid(), 'Rheumatologist', 'bone', 'Joint and autoimmune conditions'),
  (gen_random_uuid(), 'General Surgeon', 'stethoscope', 'General surgical care'),
  (gen_random_uuid(), 'Diabetologist', 'activity', 'Diabetes care')
ON CONFLICT ("name") DO NOTHING;

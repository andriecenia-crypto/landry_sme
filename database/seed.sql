-- Sample data for Sudsy. Run after schema.sql. Safe to run once on an empty project.
-- Prices are in Philippine pesos. Change them in the admin panel anytime.

insert into public.branches (name, address, contact_number) values
  ('Colon Street Branch', '123 Colon Street, Cebu City', '+63 32 255 0101'),
  ('IT Park Branch', 'Ground Floor, Skyrise 2, Lahug, Cebu City', '+63 32 255 0202'),
  ('Mandaue Branch', '45 A.S. Fortuna Street, Mandaue City', '+63 32 255 0303');

insert into public.services (name, description, unit_price, pricing_type, image_url) values
  ('Wash and fold', 'Everyday clothes washed, dried, and neatly folded.', 60.00, 'per_kg',
   'https://images.unsplash.com/photo-1545173168-9f1947eebb7f?auto=format&fit=crop&w=600&q=70'),
  ('Wash, dry, and iron', 'Fresh from the dryer and pressed, ready to hang.', 90.00, 'per_kg',
   'https://images.unsplash.com/photo-1489274495757-95c7c837b101?auto=format&fit=crop&w=600&q=70'),
  ('Dry cleaning: shirt or blouse', 'Gentle solvent cleaning and pressing.', 120.00, 'per_piece',
   'https://images.unsplash.com/photo-1604335399105-a0c585fd81a1?auto=format&fit=crop&w=600&q=70'),
  ('Dry cleaning: suit or dress', 'Full care for tailored and delicate garments.', 350.00, 'per_piece',
   'https://images.unsplash.com/photo-1593032465175-481ac7f401a0?auto=format&fit=crop&w=600&q=70'),
  ('Comforter or blanket', 'Deep wash and fluff dry for bulky bedding.', 250.00, 'per_piece',
   'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=600&q=70'),
  ('Curtains', 'Washed and dried without shrinking or fading.', 180.00, 'per_piece',
   'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=600&q=70');

insert into public.inventory (branch_id, item_name, stock_quantity, unit, reorder_level)
select b.id, i.item_name, i.stock_quantity, i.unit, i.reorder_level
from public.branches b
cross join (values
  ('Liquid detergent', 18.0, 'liters', 10.0),
  ('Fabric softener', 6.0, 'liters', 8.0),
  ('Stain remover', 9.0, 'bottles', 4.0),
  ('Garment bags', 120.0, 'pcs', 50.0),
  ('Hangers', 40.0, 'pcs', 60.0)
) as i(item_name, stock_quantity, unit, reorder_level);

-- To make yourself the shop admin: sign up in the app first, then run (with your email):
-- update public.users set role = 'admin' where email = 'you@example.com';

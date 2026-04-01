import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { productsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { adminAuth } from "./admin.js";

const router: IRouter = Router();

router.use(adminAuth);

const MART_PRODUCTS = [
  { name: "Basmati Rice 5kg",        price: 980,  originalPrice: 1200, category: "fruits",    unit: "5kg bag",    inStock: true,  description: "Premium long-grain basmati rice" },
  { name: "Doodh (Fresh Milk) 1L",   price: 140,  originalPrice: null, category: "dairy",     unit: "1 litre",    inStock: true,  description: "Fresh pasteurized milk" },
  { name: "Anday (Eggs) 12pc",       price: 320,  originalPrice: 350,  category: "dairy",     unit: "12 pieces",  inStock: true,  description: "Farm fresh eggs" },
  { name: "Aata (Wheat Flour) 10kg", price: 1100, originalPrice: 1350, category: "bakery",    unit: "10kg bag",   inStock: true,  description: "Chakki fresh atta" },
  { name: "Desi Ghee 1kg",           price: 1800, originalPrice: 2100, category: "dairy",     unit: "1kg tin",    inStock: true,  description: "Pure desi ghee" },
  { name: "Cooking Oil 5L",          price: 1650, originalPrice: 1900, category: "household", unit: "5 litre",    inStock: true,  description: "Refined sunflower oil" },
  { name: "Pyaz (Onion) 1kg",        price: 80,   originalPrice: 100,  category: "fruits",    unit: "1kg",        inStock: true,  description: "Fresh onions" },
  { name: "Tamatar (Tomato) 1kg",    price: 120,  originalPrice: 150,  category: "fruits",    unit: "1kg",        inStock: true,  description: "Fresh red tomatoes" },
  { name: "Aloo (Potato) 1kg",       price: 60,   originalPrice: 80,   category: "fruits",    unit: "1kg",        inStock: true,  description: "Fresh potatoes" },
  { name: "Sabz Mirch 250g",         price: 45,   originalPrice: null, category: "fruits",    unit: "250g",       inStock: true,  description: "Fresh green chillies" },
  { name: "Adrak Lehsun Paste",      price: 95,   originalPrice: null, category: "fruits",    unit: "200g jar",   inStock: true,  description: "Ready-made ginger garlic paste" },
  { name: "Chicken 1kg",             price: 420,  originalPrice: 480,  category: "meat",      unit: "1kg",        inStock: true,  description: "Fresh broiler chicken" },
  { name: "Gosht (Beef) 500g",       price: 650,  originalPrice: null, category: "meat",      unit: "500g",       inStock: true,  description: "Fresh beef meat" },
  { name: "Macchi (Fish) 500g",      price: 380,  originalPrice: null, category: "meat",      unit: "500g",       inStock: true,  description: "Fresh river fish" },
  { name: "Murghi ka Doodh 200ml",   price: 75,   originalPrice: null, category: "dairy",     unit: "200ml",      inStock: true,  description: "Flavored milk" },
  { name: "Dahi (Yoghurt) 500g",     price: 120,  originalPrice: null, category: "dairy",     unit: "500g",       inStock: true,  description: "Fresh yoghurt" },
  { name: "Makkhan (Butter) 200g",   price: 280,  originalPrice: 320,  category: "dairy",     unit: "200g pack",  inStock: true,  description: "Salted butter" },
  { name: "Cheese Slices 200g",      price: 350,  originalPrice: null, category: "dairy",     unit: "10 slices",  inStock: true,  description: "Processed cheese slices" },
  { name: "Naan (Fresh) 6pc",        price: 80,   originalPrice: null, category: "bakery",    unit: "6 pieces",   inStock: true,  description: "Fresh baked naan" },
  { name: "Double Roti",             price: 90,   originalPrice: null, category: "bakery",    unit: "1 loaf",     inStock: true,  description: "Sliced bread" },
  { name: "Rusk Biscuits",           price: 120,  originalPrice: null, category: "snacks",    unit: "200g pack",  inStock: true,  description: "Crispy tea rusks" },
  { name: "Peek Freans Bisconí",     price: 85,   originalPrice: null, category: "snacks",    unit: "1 pack",     inStock: true,  description: "Chocolate biscuits" },
  { name: "Lays Classic Chips",      price: 65,   originalPrice: null, category: "snacks",    unit: "85g bag",    inStock: true,  description: "Salted potato chips" },
  { name: "Nimco Mix 250g",          price: 110,  originalPrice: null, category: "snacks",    unit: "250g",       inStock: true,  description: "Traditional spicy nimco" },
  { name: "Pepsi 1.5L",              price: 130,  originalPrice: null, category: "beverages", unit: "1.5 litre",  inStock: true,  description: "Chilled Pepsi" },
  { name: "Nestle Water 1.5L",       price: 65,   originalPrice: null, category: "beverages", unit: "1.5 litre",  inStock: true,  description: "Pure mineral water" },
  { name: "Tapal Danedar Tea 200g",  price: 280,  originalPrice: 320,  category: "beverages", unit: "200g pack",  inStock: true,  description: "Strong black tea" },
  { name: "Nescafe Classic 50g",     price: 380,  originalPrice: null, category: "beverages", unit: "50g jar",    inStock: true,  description: "Instant coffee" },
  { name: "Rooh Afza 800ml",         price: 450,  originalPrice: null, category: "beverages", unit: "800ml",      inStock: true,  description: "Traditional rose drink" },
  { name: "Shampoo (Sunsilk) 180ml", price: 220,  originalPrice: 260,  category: "personal",  unit: "180ml",      inStock: true,  description: "Sunsilk shampoo" },
  { name: "Surf Excel 1kg",          price: 420,  originalPrice: 480,  category: "household", unit: "1kg box",    inStock: true,  description: "Washing powder" },
  { name: "Dettol Soap 3pc",         price: 180,  originalPrice: 210,  category: "personal",  unit: "3 bars",     inStock: true,  description: "Antibacterial soap" },
  { name: "Colgate Toothpaste",      price: 140,  originalPrice: null, category: "personal",  unit: "100g tube",  inStock: true,  description: "Cavity protection" },
  { name: "Tissue Rolls 6pc",        price: 250,  originalPrice: null, category: "household", unit: "6 rolls",    inStock: true,  description: "Soft bathroom tissue" },
  { name: "Dishwash Bar",            price: 45,   originalPrice: null, category: "household", unit: "1 bar",      inStock: true,  description: "Vim dishwash bar" },
  { name: "Ketchup 800g",            price: 220,  originalPrice: 260,  category: "household", unit: "800g bottle",inStock: true,  description: "Heinz tomato ketchup" },
  { name: "Soya Sauce 300ml",        price: 110,  originalPrice: null, category: "household", unit: "300ml",      inStock: true,  description: "Dark soya sauce" },
  { name: "Sabzi Mix Masala 50g",    price: 75,   originalPrice: null, category: "household", unit: "50g",        inStock: true,  description: "Mixed vegetable spices" },
  { name: "Shan Biryani Masala",     price: 85,   originalPrice: null, category: "household", unit: "60g pack",   inStock: true,  description: "Biryani spice mix" },
  { name: "Mango 1kg",               price: 180,  originalPrice: null, category: "fruits",    unit: "1kg",        inStock: true,  description: "Fresh sweet mangoes" },
  { name: "Kela (Banana) 12pc",      price: 90,   originalPrice: null, category: "fruits",    unit: "12 pieces",  inStock: true,  description: "Fresh bananas" },
  { name: "Seb (Apple) 500g",        price: 140,  originalPrice: null, category: "fruits",    unit: "500g",       inStock: true,  description: "Fresh apples" },
];

const FOOD_PRODUCTS = [
  { name: "Chicken Biryani",         price: 280, originalPrice: null,  category: "desi",       unit: "1 plate",    inStock: true,  description: "Aromatic spiced biryani with raita", rating: 4.8, deliveryTime: "25-35 min", vendorName: "Biryani House AJK" },
  { name: "Beef Nihari",             price: 320, originalPrice: null,  category: "desi",       unit: "1 portion",  inStock: true,  description: "Slow-cooked beef with rich gravy + naan", rating: 4.9, deliveryTime: "30-40 min", vendorName: "Desi Dhaba" },
  { name: "Chicken Karahi",          price: 450, originalPrice: 500,   category: "desi",       unit: "2 portions", inStock: true,  description: "Wok-cooked chicken with tomatoes & spices", rating: 4.7, deliveryTime: "25-35 min", vendorName: "Desi Dhaba" },
  { name: "Dal Makhani",             price: 180, originalPrice: null,  category: "desi",       unit: "1 portion",  inStock: true,  description: "Creamy black lentil dal + naan", rating: 4.6, deliveryTime: "20-30 min", vendorName: "Biryani House AJK" },
  { name: "Lamb Sajji",              price: 550, originalPrice: 600,   category: "desi",       unit: "half leg",   inStock: true,  description: "Balochi-style whole roasted lamb", rating: 4.9, deliveryTime: "45-60 min", vendorName: "Sajji Palace" },
  { name: "Chicken Tikka",           price: 380, originalPrice: null,  category: "restaurants",unit: "6 pieces",   inStock: true,  description: "Tandoor-grilled marinated chicken", rating: 4.8, deliveryTime: "30-40 min", vendorName: "Grill House Muzaffarabad" },
  { name: "Seekh Kabab",             price: 250, originalPrice: null,  category: "restaurants",unit: "4 pieces",   inStock: true,  description: "Minced beef kabab off the grill + chutney", rating: 4.7, deliveryTime: "20-30 min", vendorName: "Grill House Muzaffarabad" },
  { name: "Paye (Trotters Soup)",    price: 220, originalPrice: null,  category: "desi",       unit: "1 bowl",     inStock: true,  description: "Slow-cooked goat trotters with naan", rating: 4.8, deliveryTime: "35-45 min", vendorName: "Desi Dhaba" },
  { name: "Chappal Kabab Roll",      price: 150, originalPrice: null,  category: "fast-food",  unit: "1 roll",     inStock: true,  description: "Crispy chappal kabab in paratha with salad", rating: 4.6, deliveryTime: "15-25 min", vendorName: "Fast Food Corner" },
  { name: "Chicken Broast",          price: 350, originalPrice: 400,   category: "fast-food",  unit: "4 pieces",   inStock: true,  description: "Crispy pressure-fried chicken + fries + sauce", rating: 4.7, deliveryTime: "20-30 min", vendorName: "Fast Food Corner" },
  { name: "Zinger Burger",           price: 220, originalPrice: 250,   category: "fast-food",  unit: "1 burger",   inStock: true,  description: "Crispy chicken fillet burger with special sauce", rating: 4.5, deliveryTime: "15-25 min", vendorName: "Burger Point AJK" },
  { name: "Double Beef Burger",      price: 280, originalPrice: null,  category: "fast-food",  unit: "1 burger",   inStock: true,  description: "Double patty beef burger with fries", rating: 4.6, deliveryTime: "20-30 min", vendorName: "Burger Point AJK" },
  { name: "Loaded Fries",            price: 180, originalPrice: null,  category: "fast-food",  unit: "1 box",      inStock: true,  description: "Crispy fries with cheese sauce & jalapeños", rating: 4.4, deliveryTime: "15-20 min", vendorName: "Burger Point AJK" },
  { name: "Chinese Chow Mein",       price: 200, originalPrice: null,  category: "chinese",    unit: "1 plate",    inStock: true,  description: "Stir-fried noodles with vegetables & chicken", rating: 4.5, deliveryTime: "25-35 min", vendorName: "China Town AJK" },
  { name: "Chicken Manchurian",      price: 280, originalPrice: null,  category: "chinese",    unit: "1 portion",  inStock: true,  description: "Crispy chicken in tangy manchurian sauce", rating: 4.6, deliveryTime: "25-35 min", vendorName: "China Town AJK" },
  { name: "Fried Rice",              price: 180, originalPrice: null,  category: "chinese",    unit: "1 plate",    inStock: true,  description: "Egg fried rice with mixed vegetables", rating: 4.4, deliveryTime: "20-30 min", vendorName: "China Town AJK" },
  { name: "Chicken Shawarma",        price: 160, originalPrice: null,  category: "restaurants",unit: "1 roll",     inStock: true,  description: "Lebanese-style chicken wrap with garlic sauce", rating: 4.7, deliveryTime: "15-20 min", vendorName: "Shawarma House" },
  { name: "Beef Shawarma",           price: 180, originalPrice: null,  category: "restaurants",unit: "1 roll",     inStock: true,  description: "Spiced beef shawarma with fresh vegetables", rating: 4.8, deliveryTime: "15-20 min", vendorName: "Shawarma House" },
  { name: "Chicken Pizza 8''",       price: 450, originalPrice: 500,   category: "pizza",      unit: "8 inch",     inStock: true,  description: "Thin crust with chicken tikka & cheese", rating: 4.6, deliveryTime: "30-45 min", vendorName: "Pizza Palace AJK" },
  { name: "Beef Pepperoni Pizza",    price: 520, originalPrice: null,  category: "pizza",      unit: "8 inch",     inStock: true,  description: "Classic pepperoni pizza with extra cheese", rating: 4.7, deliveryTime: "30-45 min", vendorName: "Pizza Palace AJK" },
  { name: "Gulab Jamun 6pc",         price: 120, originalPrice: null,  category: "desserts",   unit: "6 pieces",   inStock: true,  description: "Soft milk-solid dumplings in sugar syrup", rating: 4.9, deliveryTime: "15-25 min", vendorName: "Mithai House" },
  { name: "Kheer",                   price: 100, originalPrice: null,  category: "desserts",   unit: "1 bowl",     inStock: true,  description: "Creamy rice pudding with cardamom", rating: 4.8, deliveryTime: "20-30 min", vendorName: "Mithai House" },
  { name: "Shahi Tukray",            price: 150, originalPrice: null,  category: "desserts",   unit: "2 pieces",   inStock: true,  description: "Fried bread in sweetened cream & dry fruits", rating: 4.9, deliveryTime: "20-30 min", vendorName: "Mithai House" },
  { name: "Waffles with Ice Cream",  price: 250, originalPrice: null,  category: "desserts",   unit: "1 plate",    inStock: true,  description: "Belgian waffles + 2 scoops ice cream", rating: 4.7, deliveryTime: "20-30 min", vendorName: "Cafe AJK" },
  { name: "Halwa Puri (Breakfast)",  price: 180, originalPrice: null,  category: "desi",       unit: "1 set",      inStock: true,  description: "Sooji halwa + 2 puri + chana + achar", rating: 4.8, deliveryTime: "20-30 min", vendorName: "Biryani House AJK" },
];

router.post("/products", async (req, res) => {
  const existingMart = await db.select().from(productsTable).where(eq(productsTable.type, "mart")).limit(1);
  const existingFood = await db.select().from(productsTable).where(eq(productsTable.type, "food")).limit(1);

  let seededMart = 0;
  let seededFood = 0;

  if (existingMart.length === 0) {
    for (const p of MART_PRODUCTS) {
      await db.insert(productsTable).values({
        id: generateId(),
        name: p.name,
        description: p.description,
        price: p.price.toString(),
        originalPrice: p.originalPrice ? p.originalPrice.toString() : null,
        category: p.category,
        type: "mart",
        vendorId: "ajkmart_system",
        vendorName: "AJKMart Store",
        unit: p.unit,
        inStock: p.inStock,
        rating: (3.8 + Math.random() * 1.1).toFixed(1),
        reviewCount: Math.floor(Math.random() * 200) + 10,
      });
      seededMart++;
    }
  }

  if (existingFood.length === 0) {
    for (const p of FOOD_PRODUCTS) {
      await db.insert(productsTable).values({
        id: generateId(),
        name: p.name,
        description: p.description,
        price: p.price.toString(),
        originalPrice: p.originalPrice ? p.originalPrice.toString() : null,
        category: p.category,
        type: "food",
        vendorId: "ajkmart_system",
        unit: p.unit,
        inStock: p.inStock,
        rating: ((p as any).rating || 4.5).toString(),
        reviewCount: Math.floor(Math.random() * 500) + 50,
        vendorName: (p as any).vendorName || "Restaurant AJK",
        deliveryTime: (p as any).deliveryTime || "25-35 min",
      });
      seededFood++;
    }
  }

  res.json({
    success: true,
    seeded: { mart: seededMart, food: seededFood },
    skipped: { mart: existingMart.length > 0, food: existingFood.length > 0 },
    message: seededMart + seededFood > 0
      ? `${seededMart} mart + ${seededFood} food products seeded`
      : "Products already exist — skipped",
  });
});

export default router;

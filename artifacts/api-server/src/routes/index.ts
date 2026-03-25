import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import usersRouter from "./users.js";
import productsRouter from "./products.js";
import ordersRouter from "./orders.js";
import walletRouter from "./wallet.js";
import ridesRouter from "./rides.js";
import locationsRouter from "./locations.js";
import categoriesRouter from "./categories.js";
import pharmacyRouter from "./pharmacy.js";
import parcelRouter from "./parcel.js";
import notificationsRouter from "./notifications.js";
import addressesRouter from "./addresses.js";
import settingsRouter from "./settings.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/products", productsRouter);
router.use("/orders", ordersRouter);
router.use("/wallet", walletRouter);
router.use("/rides", ridesRouter);
router.use("/locations", locationsRouter);
router.use("/categories", categoriesRouter);
router.use("/pharmacy-orders", pharmacyRouter);
router.use("/parcel-bookings", parcelRouter);
router.use("/notifications", notificationsRouter);
router.use("/addresses", addressesRouter);
router.use("/settings", settingsRouter);

export default router;

import { format } from "date-fns";
import { getCurrencySymbol } from "./platformConfig";

export const formatCurrency = (amount: number) => {
  return `${getCurrencySymbol()} ${amount.toLocaleString()}`;
};

export const formatDate = (dateString: string) => {
  try {
    return format(new Date(dateString), "MMM d, yyyy h:mm a");
  } catch (e) {
    return dateString;
  }
};

export const getStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case 'pending':
    case 'searching':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'confirmed':
    case 'accepted':
    case 'ongoing':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'preparing':
    case 'arrived':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'out_for_delivery':
    case 'in_transit':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'delivered':
    case 'completed':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'cancelled':
      return 'bg-red-100 text-red-800 border-red-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

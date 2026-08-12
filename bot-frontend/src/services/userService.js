import { apiRequest } from "./api";

export const fetchUsers = async () => {
    try {
        const data = await apiRequest("/user/users");
        return data.users || [];
    } catch (error) {
        console.error("❌ Error fetching users data:", error);
        return null;
    }
};

export const fetchUserData = async () => {
    try {
        const data = await apiRequest("/user/user");
        return data.user;
    } catch (error) {
        console.error("❌ Error fetching user data:", error);
        return null;
    }
};

export const fetchUserRole = async () => {
    try {
        const data = await apiRequest("/user/user-role");
        return data.user;
    } catch (error) {
        console.error("❌ Error fetching user data:", error);
        return null;
    }
};

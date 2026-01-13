import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getAccessToken } from "@/lib/api";

const Home = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      navigate("/projects", { replace: true });
    } else {
      navigate("/signup", { replace: true });
    }
  }, [navigate]);

  return null;
};

export default Home;

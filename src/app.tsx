import styles from "@/css/app.module.scss";
import { useState } from "react";

const App: React.FC = () => {
  const [count, setCount] = useState(0);

  const onButtonClick = () => {
    setCount((prevCount) => prevCount + 1);
  };

  return (
    <div className={styles.container}>
      <div className={styles.title}>{"My Custom App!"}</div>
      <button className={styles.button} onClick={onButtonClick}>
        {"Count up"}
      </button>
      <div className={styles.counter}>{count}</div>
    </div>
  );
};

export default App;
